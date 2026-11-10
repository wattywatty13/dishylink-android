// Routes the requests a WebView page cannot make itself through native HTTP.
//
// The page is served from https://localhost, so:
// - the dish (http://192.168.100.1:9201) and router (http://192.168.1.1:9001) are
//   plain-http, cross-origin, and the dish refuses requests carrying a browser
//   Origin/Referer — native requests send neither;
// - starlink.com sends no CORS headers for this origin, and its session cookie has
//   to be attached by hand (the extension does that with a declarativeNetRequest
//   rule; the shim's rule list is applied here);
// - celestrak.org sends no CORS headers at all.
//
// Everything else (same-origin assets, Cloudflare's speed test, which allows CORS)
// stays on the WebView's own fetch, so large transfers are not base64-copied
// across the bridge.

import { Capacitor } from "@capacitor/core";
import { StarlinkNative } from "./native";
import { cookieHeaderFor } from "./shim/browser";

const NATIVE_HTTPS_HOSTS = [/(^|\.)starlink\.com$/, /(^|\.)celestrak\.org$/];

function goesNative(url: URL): boolean {
  if (url.origin === location.origin) return false;
  if (url.protocol === "http:") return true;
  return url.protocol === "https:" && NATIVE_HTTPS_HOSTS.some((host) => host.test(url.hostname));
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

/** Development in a desktop browser (no native layer): with localStorage.fakeDish
 *  set, the LAN boxes are dev/fakeDish.mts, reached through the dev server's proxy. */
function devRewrite(url: URL): string | null {
  if (!import.meta.env.DEV || Capacitor.isNativePlatform()) return null;
  if (localStorage.getItem("fakeDish") !== "1") return null;
  if (url.hostname === "192.168.100.1") return `${location.origin}/fake-dish${url.pathname}`;
  if (url.hostname === "192.168.1.1") return `${location.origin}/fake-router${url.pathname}`;
  return null;
}

export function installNativeFetch(): void {
  const webFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const devUrl = devRewrite(url);
    if (devUrl) {
      // Body copied as bytes: re-wrapping the Request would send it as a stream,
      // which Chrome only does over HTTP/2.
      const hasBody = request.method !== "GET" && request.method !== "HEAD";
      return webFetch(devUrl, {
        method: request.method,
        headers: request.headers,
        body: hasBody ? await request.arrayBuffer() : undefined,
        signal: init?.signal ?? request.signal,
      });
    }
    if (!goesNative(url)) return webFetch(input, init);

    const signal = init?.signal ?? request.signal;
    if (signal?.aborted) throw abortError();

    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => {
      headers[name] = value;
    });
    const cookie = cookieHeaderFor(url);
    if (cookie) headers.cookie = headers.cookie ? `${headers.cookie}; ${cookie}` : cookie;

    const method = request.method.toUpperCase();
    const bodyBytes =
      method === "GET" || method === "HEAD" ? null : new Uint8Array(await request.arrayBuffer());

    const call = StarlinkNative.http({
      url: url.toString(),
      method,
      headers,
      body: bodyBytes && bodyBytes.length > 0 ? toBase64(bodyBytes) : undefined,
      timeoutMs: 30_000,
    });

    // The native call cannot be cancelled mid-flight; an aborted caller is
    // answered at once and the late reply is dropped.
    const reply = await new Promise<Awaited<typeof call>>((resolve, reject) => {
      const onAbort = () => reject(abortError());
      signal?.addEventListener("abort", onAbort, { once: true });
      call
        .then(resolve, (error: unknown) => reject(new TypeError(String(error))))
        .finally(() => signal?.removeEventListener("abort", onAbort));
    });

    const nullBody = reply.status === 204 || reply.status === 304 || method === "HEAD";
    return new Response(nullBody ? null : (fromBase64(reply.body) as BodyInit), {
      status: reply.status < 200 || reply.status > 599 ? 502 : reply.status,
      headers: reply.headers,
    });
  };
}

// Run with: npx vitest run --config vite.mobile.config.ts
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// ---- a minimal page environment (node has no DOM) ----
const store = new Map<string, string>();
const nativeCalls: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}[] = [];
const webCalls: string[] = [];

beforeAll(() => {
  Object.assign(globalThis, {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    },
    document: { visibilityState: "visible" },
    location: { origin: "https://localhost", href: "https://localhost/" },
    window: globalThis,
  });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    webCalls.push(String(input instanceof Request ? input.url : input));
    return new Response("web");
  }) as typeof fetch;
});

vi.mock("./native", () => ({
  StarlinkNative: {
    http: vi.fn(
      async (request: {
        url: string;
        method: string;
        headers: Record<string, string>;
        body?: string;
      }) => {
        nativeCalls.push(request);
        return {
          status: 200,
          headers: { "content-type": "application/grpc-web+proto", "grpc-status": "0" },
          body: btoa("\x00\x00\x00\x00\x01\x2a"),
        };
      },
    ),
    getCookies: vi.fn(async () => ({
      cookies: [
        { name: "Starlink.Com.Sso", value: "abc" },
        { name: "Access.V1", value: "xyz" },
      ],
    })),
    startRecorder: vi.fn(async () => {}),
    notify: vi.fn(async () => {}),
  },
}));

afterEach(() => {
  nativeCalls.length = 0;
  webCalls.length = 0;
});

describe("browser shim", () => {
  it("stores, reads back and announces changes like chrome.storage.local", async () => {
    const { browser } = await import("./shim/browser");
    const seen: unknown[] = [];
    browser.storage.onChanged.addListener((changes, area) => seen.push([changes, area]));
    await browser.storage.local.set({ routerAddress: { router: "10.0.0.1" } });
    expect(await browser.storage.local.get("routerAddress")).toEqual({
      routerAddress: { router: "10.0.0.1" },
    });
    expect(await browser.storage.local.get(["missing"])).toEqual({});
    await browser.storage.local.remove("routerAddress");
    expect(await browser.storage.local.get("routerAddress")).toEqual({});
    await Promise.resolve();
    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual([
      { routerAddress: { oldValue: undefined, newValue: { router: "10.0.0.1" } } },
      "local",
    ]);
  });

  it("routes runtime messages to the in-page background listener", async () => {
    const { browser } = await import("./shim/browser");
    const listener = (message: unknown) =>
      (message as { type: string }).type === "api"
        ? Promise.resolve({ status: 200, body: [1] })
        : false;
    browser.runtime.onMessage.addListener(listener);
    expect(await browser.runtime.sendMessage({ type: "api", path: "/api/x" })).toEqual({
      status: 200,
      body: [1],
    });
    expect(await browser.runtime.sendMessage({ type: "other" })).toBeUndefined();
    browser.runtime.onMessage.removeListener(listener);
  });

  it("fires an alarm once per period whether the JS timer or the native tick comes first", async () => {
    vi.useFakeTimers();
    const { browser, fireDueAlarms } = await import("./shim/browser");
    const fired: string[] = [];
    browser.alarms.onAlarm.addListener((alarm) => fired.push(alarm.name));
    browser.alarms.create("drain", { periodInMinutes: 0.5 });
    fireDueAlarms(); // native tick straight away: not due yet
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(30_000); // JS interval fires
    fireDueAlarms(); // native tick right after: already fired this period
    expect(fired).toEqual(["drain"]);
    vi.advanceTimersByTime(29_000);
    fireDueAlarms(); // throttled JS timer missed, native tick catches it
    expect(fired).toEqual(["drain", "drain"]);
    expect(await browser.alarms.get("drain")).toMatchObject({
      name: "drain",
      periodInMinutes: 0.5,
    });
    await browser.alarms.clear("drain");
    vi.useRealTimers();
  });

  it("captures the sign-in cookies and attaches them only to starlink.com", async () => {
    const { browser, cookieHeaderFor } = await import("./shim/browser");
    const cookies = await browser.cookies.getAll({ domain: "starlink.com" });
    const header = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    await browser.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [1],
      addRules: [
        {
          id: 1,
          action: {
            type: "modifyHeaders",
            requestHeaders: [{ header: "Cookie", operation: "append", value: header }],
          },
          condition: { requestDomains: ["starlink.com"] },
        },
      ],
    });
    expect(cookieHeaderFor(new URL("https://api.starlink.com/x"))).toBe(
      "Starlink.Com.Sso=abc; Access.V1=xyz",
    );
    expect(cookieHeaderFor(new URL("https://evilstarlink.com/x"))).toBeNull();
    expect(cookieHeaderFor(new URL("http://192.168.100.1:9201/x"))).toBeNull();
    await browser.declarativeNetRequest.updateSessionRules({ removeRuleIds: [1] });
    expect(cookieHeaderFor(new URL("https://api.starlink.com/x"))).toBeNull();
  });

  it("turns the badge count into the recording notification's text", async () => {
    const { browser } = await import("./shim/browser");
    const { StarlinkNative } = await import("./native");
    await browser.action.setBadgeText({ text: "2" });
    await browser.action.setBadgeText({ text: "2" });
    await browser.action.setBadgeText({ text: "" });
    expect(vi.mocked(StarlinkNative.startRecorder).mock.calls.map((c) => c[0].status)).toEqual([
      "2 alerts active",
      "Recording your Starlink",
    ]);
  });
});

describe("native fetch routing", () => {
  it("sends dish grpc-web calls natively with the binary body intact, and leaves the rest to the WebView", async () => {
    const { installNativeFetch } = await import("./nativeFetch");
    installNativeFetch();

    const frame = new Uint8Array([0, 0, 0, 0, 2, 0x92, 0x7d]);
    const reply = await fetch("http://192.168.100.1:9201/SpaceX.API.Device.Device/Handle", {
      method: "POST",
      headers: { "Content-Type": "application/grpc-web+proto", "X-Grpc-Web": "1" },
      body: frame,
    });
    expect(nativeCalls).toHaveLength(1);
    expect(nativeCalls[0].method).toBe("POST");
    expect(nativeCalls[0].headers["x-grpc-web"]).toBe("1");
    expect(Uint8Array.from(atob(nativeCalls[0].body!), (c) => c.charCodeAt(0))).toEqual(frame);
    expect(reply.status).toBe(200);
    expect(reply.headers.get("grpc-status")).toBe("0");
    expect(new Uint8Array(await reply.arrayBuffer())).toEqual(
      new Uint8Array([0, 0, 0, 0, 1, 0x2a]),
    );

    await fetch("https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink");
    expect(nativeCalls).toHaveLength(2);

    await fetch("https://speed.cloudflare.com/__down?bytes=1000");
    await fetch("https://localhost/dish.protoset");
    expect(nativeCalls).toHaveLength(2);
    expect(webCalls).toEqual([
      "https://speed.cloudflare.com/__down?bytes=1000",
      "https://localhost/dish.protoset",
    ]);
  });

  it("rejects with AbortError when the caller aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetch("http://192.168.1.1:9001/SpaceX.API.Device.Device/Handle", {
        method: "POST",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

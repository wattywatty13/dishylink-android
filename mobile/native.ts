// The Android app's native side, as the web layer sees it. One Capacitor plugin
// (android/app/src/main/java/.../StarlinkNativePlugin.kt) carries everything a
// WebView cannot do on its own: reach the LAN boxes and starlink.com without CORS
// or mixed-content limits, read the sign-in WebView's cookies, post notifications,
// and run the foreground service that keeps the recorder alive in the background.

import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export interface NativeHttpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** Base64 request body, or absent for none. */
  body?: string;
  timeoutMs?: number;
}

export interface NativeHttpResponse {
  status: number;
  headers: Record<string, string>;
  /** Base64 response body (empty string for none). */
  body: string;
}

export interface StarlinkNativePlugin {
  http(request: NativeHttpRequest): Promise<NativeHttpResponse>;
  /** Every cookie the app's cookie store holds for these URLs, as `name=value` pairs. */
  getCookies(options: { urls: string[] }): Promise<{ cookies: { name: string; value: string }[] }>;
  /** Opens starlink.com in an in-app browser screen whose cookies the app can read. */
  openSignIn(options: { url: string }): Promise<void>;
  openExternal(options: { url: string }): Promise<void>;
  notify(options: { id: string; title: string; body: string }): Promise<void>;
  requestNotificationPermission(): Promise<{ granted: boolean }>;
  /** Starts (or updates the text of) the background-recording foreground service. */
  startRecorder(options: { status: string }): Promise<void>;
  stopRecorder(): Promise<void>;
  addListener(event: "tick", listener: () => void): Promise<PluginListenerHandle>;
}

export const StarlinkNative = registerPlugin<StarlinkNativePlugin>("StarlinkNative");

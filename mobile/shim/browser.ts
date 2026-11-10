// Stand-in for `wxt/browser` on Android.
//
// The Android app reuses the browser extension's host code (extension/lib/* and
// its background worker) unchanged. Those modules talk to the browser through the
// WebExtension API; this module implements the part of that API they use, on top
// of the WebView and the app's native plugin. In the app the "service worker" and
// the dashboard share one page, so messaging is an in-page dispatch and storage is
// one localStorage namespace.

import { StarlinkNative } from "../native";

type Listener<A extends unknown[]> = (...args: A) => unknown;

function event<A extends unknown[]>() {
  const listeners = new Set<Listener<A>>();
  return {
    listeners,
    addListener: (listener: Listener<A>) => void listeners.add(listener),
    removeListener: (listener: Listener<A>) => void listeners.delete(listener),
    hasListener: (listener: Listener<A>) => listeners.has(listener),
  };
}

// ---------- storage ----------

const PREFIX = "ext:";
type Changes = Record<string, { oldValue?: unknown; newValue?: unknown }>;
const storageChanged = event<[Changes, string]>();

function readKey(key: string): unknown {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function allKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(PREFIX)) keys.push(key.slice(PREFIX.length));
  }
  return keys;
}

function announce(changes: Changes): void {
  if (Object.keys(changes).length === 0) return;
  // Asynchronous, as the real event is: a listener never runs inside the write.
  queueMicrotask(() => {
    for (const listener of storageChanged.listeners) listener(changes, "local");
  });
}

const local = {
  async get(keys?: string | string[] | Record<string, unknown> | null) {
    const result: Record<string, unknown> = {};
    if (keys === undefined || keys === null) {
      for (const key of allKeys()) result[key] = readKey(key);
      return result;
    }
    const wanted =
      typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
    for (const key of wanted) {
      const value = readKey(key);
      if (value !== undefined) result[key] = value;
      else if (typeof keys === "object" && !Array.isArray(keys) && keys !== null)
        result[key] = (keys as Record<string, unknown>)[key];
    }
    return result;
  },
  async set(items: Record<string, unknown>) {
    const changes: Changes = {};
    for (const [key, newValue] of Object.entries(items)) {
      const oldValue = readKey(key);
      localStorage.setItem(PREFIX + key, JSON.stringify(newValue));
      changes[key] = { oldValue, newValue };
    }
    announce(changes);
  },
  async remove(keys: string | string[]) {
    const changes: Changes = {};
    for (const key of typeof keys === "string" ? [keys] : keys) {
      const oldValue = readKey(key);
      if (oldValue === undefined) continue;
      localStorage.removeItem(PREFIX + key);
      changes[key] = { oldValue };
    }
    announce(changes);
  },
};

// ---------- runtime messaging ----------

type MessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => unknown;
const messageEvent = event<Parameters<MessageListener>>();

async function sendMessage(message: unknown): Promise<unknown> {
  for (const listener of messageEvent.listeners) {
    let responded: ((value: unknown) => void) | undefined;
    const viaCallback = new Promise((resolve) => (responded = resolve));
    const returned = listener(message, { id: "android" }, (response) => responded?.(response));
    if (returned instanceof Promise) return returned;
    if (returned === true) return viaCallback;
  }
  return undefined;
}

// ---------- alarms ----------
//
// Each alarm fires from a JS interval and also from the native foreground
// service's tick (which keeps firing when Android throttles a backgrounded
// page). A per-alarm last-fired time stops the two sources doubling up, so the
// boxes are never polled more often than the extension polls them.

interface Alarm {
  name: string;
  periodInMinutes: number;
  scheduledTime: number;
}
const alarmEvent = event<[Alarm]>();
const alarms = new Map<
  string,
  { alarm: Alarm; timer: ReturnType<typeof setInterval>; lastFired: number }
>();

function fireIfDue(name: string): void {
  const entry = alarms.get(name);
  if (!entry) return;
  const periodMs = entry.alarm.periodInMinutes * 60_000;
  const now = Date.now();
  if (now - entry.lastFired < periodMs * 0.9) return;
  entry.lastFired = now;
  entry.alarm.scheduledTime = now + periodMs;
  for (const listener of alarmEvent.listeners) listener({ ...entry.alarm });
}

/** Called on each native tick. */
export function fireDueAlarms(): void {
  for (const name of alarms.keys()) fireIfDue(name);
}

const alarmsApi = {
  create(name: string, info: { periodInMinutes: number }) {
    const existing = alarms.get(name);
    if (existing) clearInterval(existing.timer);
    const periodMs = info.periodInMinutes * 60_000;
    const alarm = {
      name,
      periodInMinutes: info.periodInMinutes,
      scheduledTime: Date.now() + periodMs,
    };
    const timer = setInterval(() => fireIfDue(name), periodMs);
    alarms.set(name, { alarm, timer, lastFired: Date.now() });
  },
  async get(name: string) {
    return alarms.get(name)?.alarm;
  },
  async clear(name: string) {
    const existing = alarms.get(name);
    if (existing) clearInterval(existing.timer);
    return alarms.delete(name);
  },
  onAlarm: alarmEvent,
};

// ---------- the starlink.com session cookie ----------
//
// The extension appends its captured session to starlink.com requests with a
// declarativeNetRequest session rule. Here the rule list is kept in memory and
// the native fetch applies it (mobile/nativeFetch.ts).

interface HeaderRule {
  id: number;
  priority?: number;
  action: {
    type: string;
    requestHeaders?: { header: string; operation: string; value?: string }[];
  };
  condition: { requestDomains?: string[]; resourceTypes?: string[]; tabIds?: number[] };
}
let sessionRules: HeaderRule[] = [];

export function cookieHeaderFor(url: URL): string | null {
  const values: string[] = [];
  for (const rule of sessionRules) {
    const domains = rule.condition.requestDomains ?? [];
    if (!domains.some((domain) => url.hostname === domain || url.hostname.endsWith("." + domain)))
      continue;
    for (const header of rule.action.requestHeaders ?? []) {
      if (header.header.toLowerCase() === "cookie" && header.value) values.push(header.value);
    }
  }
  return values.length ? values.join("; ") : null;
}

const STARLINK_COOKIE_URLS = [
  "https://starlink.com",
  "https://www.starlink.com",
  "https://api.starlink.com",
  "https://account.starlink.com",
];

// ---------- windows, tabs, the toolbar action ----------
//
// The app is one full-screen page. "The dashboard is in front" — what the worker
// checks before posting a notification instead of letting the page chime — is
// whether the app is visible.

const DASHBOARD_TAB = 1;
const DASHBOARD_WINDOW = 1;

interface ShimWindow {
  id: number;
  type: string;
  focused: boolean;
  top?: number;
  left?: number;
  width?: number;
  height?: number;
}
interface ShimTab {
  id?: number;
  windowId?: number;
  active: boolean;
  lastAccessed?: number;
}
const inFront = () => document.visibilityState === "visible";

function isStarlink(url: string | undefined): boolean {
  return !!url && /^https:\/\/([^/]*\.)?starlink\.com(\/|$)/.test(url);
}

let lastStatus = "";
function setRecorderStatus(badge: string): void {
  const count = Number(badge);
  const status =
    badge === "" || !Number.isFinite(count)
      ? "Recording your Starlink"
      : `${count} alert${count === 1 ? "" : "s"} active`;
  if (status === lastStatus) return;
  lastStatus = status;
  void StarlinkNative.startRecorder({ status }).catch(() => {});
}

export const browser = {
  runtime: {
    id: "android",
    getURL: (path: string) => path,
    sendMessage,
    onMessage: messageEvent,
  },
  storage: { local, onChanged: storageChanged },
  alarms: alarmsApi,
  notifications: {
    async create(
      id: string,
      options: { title: string; message: string; type?: string; iconUrl?: string },
    ) {
      await StarlinkNative.notify({ id, title: options.title, body: options.message });
      return id;
    },
    onClicked: event<[string]>(),
  },
  action: {
    async setBadgeText({ text }: { text: string }) {
      setRecorderStatus(text);
    },
    async setBadgeBackgroundColor(_details: { color: string }) {},
    async setBadgeTextColor(_details: { color: string }) {},
    onClicked: event<[unknown]>(),
  },
  // Firefox's MV2 name for `action`; background.ts falls back to it. Never used here.
  browserAction: undefined as never,
  windows: {
    async get(id: number): Promise<ShimWindow> {
      if (id !== DASHBOARD_WINDOW) throw new Error("No window with that id");
      return { id, type: "popup", focused: inFront() };
    },
    async update(_id: number, _info: Record<string, unknown>): Promise<ShimWindow> {
      return { id: DASHBOARD_WINDOW, type: "popup", focused: inFront() };
    },
    async create(_info: Record<string, unknown>): Promise<ShimWindow> {
      return { id: DASHBOARD_WINDOW, type: "popup", focused: inFront() };
    },
    onBoundsChanged: event<[{ id?: number }]>(),
    onRemoved: event<[number]>(),
  },
  tabs: {
    async query({ url }: { url?: string }): Promise<ShimTab[]> {
      // No starlink.com tab exists until sign-in opens one; the dashboard is the
      // only other "tab".
      if (url && /starlink\.com/.test(url)) return [];
      return [{ id: DASHBOARD_TAB, windowId: DASHBOARD_WINDOW, active: inFront() }];
    },
    async update(_id: number, _info: Record<string, unknown>): Promise<ShimTab> {
      return { id: DASHBOARD_TAB, windowId: DASHBOARD_WINDOW, active: inFront() };
    },
    async create({ url }: { url: string; active?: boolean }): Promise<ShimTab> {
      if (isStarlink(url)) await StarlinkNative.openSignIn({ url });
      else await StarlinkNative.openExternal({ url });
      return { id: DASHBOARD_TAB + 1, windowId: DASHBOARD_WINDOW, active: true };
    },
  },
  cookies: {
    async getAll(_details: { domain: string }) {
      const { cookies } = await StarlinkNative.getCookies({ urls: STARLINK_COOKIE_URLS });
      return cookies;
    },
  },
  declarativeNetRequest: {
    async updateSessionRules({
      removeRuleIds = [],
      addRules = [],
    }: {
      removeRuleIds?: number[];
      addRules?: HeaderRule[];
    }) {
      sessionRules = sessionRules
        .filter((rule) => !removeRuleIds.includes(rule.id))
        .concat(addRules);
    },
  },
  permissions: {
    // Android grants the app the whole LAN; a configured router address needs no grant.
    async request(_permissions: { origins?: string[] }) {
      return true;
    },
  },
  i18n: {
    getUILanguage: () => navigator.language,
  },
};

export default browser;

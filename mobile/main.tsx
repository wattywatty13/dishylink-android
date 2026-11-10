import "./boot";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./android.css";
import "@/i18n";
import App from "@/App";

import { setApiHost } from "@/lib/apiHost";
import { setCloudHost } from "@/lib/cloudHost";
import { setSelfDeviceHost } from "@/lib/selfDeviceHost";
import { bindNotifications, setNotificationHost } from "@/lib/notifications";
import { setBadgeModeHost } from "@/lib/badgeMode";
import { setLocaleHost } from "@/lib/locale";
import { setDishHost } from "@core/dishClient";
import { setSatelliteHost } from "@/lib/satellites";
import { setRouterAddressHost } from "@/lib/routerAddressHost";
import { extensionBadgeModeHost } from "../extension/lib/badgeModeHost";
import { extensionLocaleHost } from "../extension/lib/localeHost";
import { extensionApiTransport } from "../extension/lib/apiTransport";
import { extensionCloudSignIn, extensionCloudTransport } from "../extension/lib/cloudTransport";
import { extensionNotificationHost } from "../extension/lib/notificationHost";
import { startClientSampler } from "../extension/lib/clientSampler";
import { reportSelfTraffic } from "../extension/lib/selfTrafficReporter";
import { loadSelfDeviceClientId, storeSelfDeviceClientId } from "../extension/lib/selfDevice";
import {
  dishHandleUrl,
  loadRouterAddress,
  routerHandleUrl,
  storeRouterAddress,
  watchRouterAddress,
  ROUTER_LAN_ADDRESS,
} from "../extension/lib/endpoints";
import startRecorder from "../extension/entrypoints/background";
import { fireDueAlarms } from "./shim/browser";
import { StarlinkNative } from "./native";

// The Android app is the browser extension's dashboard and recorder in one page.
// The extension's host modules are reused as they are: mobile/shim/browser.ts
// stands in for the WebExtension API they call, and mobile/nativeFetch.ts carries
// the LAN and starlink.com requests a WebView cannot make. The bindings below are
// the extension dashboard's (extension/entrypoints/dashboard/main.tsx); the
// differences are commented.

setApiHost({ transport: extensionApiTransport });
setCloudHost({ transport: extensionCloudTransport, signIn: extensionCloudSignIn });

// Android does not tell an app its own Wi-Fi MAC, so — as in the extension — the
// device this runs on is the roster entry the user names.
setSelfDeviceHost({
  read: loadSelfDeviceClientId,
  write: storeSelfDeviceClientId,
  namingCorrectsUsage: true,
});

setNotificationHost(extensionNotificationHost);
setBadgeModeHost(extensionBadgeModeHost);
setLocaleHost(extensionLocaleHost);

watchRouterAddress();
setRouterAddressHost({
  read: async () => ({ ...(await loadRouterAddress()), routerDefault: ROUTER_LAN_ADDRESS }),
  write: async (address) => {
    const stored = await storeRouterAddress(address);
    if (!stored.ok) return stored;
    setTimeout(() => location.reload(), 0);
    return { ok: true, addresses: { ...stored.addresses, routerDefault: ROUTER_LAN_ADDRESS } };
  },
});

// celestrak.org goes through native HTTP (mobile/nativeFetch.ts), as it has no CORS.
setSatelliteHost("https://celestrak.org");

function startSampler(): void {
  const stopClientSampler = startClientSampler();
  window.addEventListener("pagehide", stopClientSampler);
}

loadRouterAddress()
  .then(() => {
    setDishHost({
      dishHandleUrl: dishHandleUrl(),
      routerHandleUrl: routerHandleUrl(),
      onBytes: reportSelfTraffic,
    });
    // The extension's background worker — history recording, alerts, data
    // limits, the account session — runs in this same page. The foreground
    // service keeps the app alive with the screen off and ticks the recorder's
    // alarms when Android throttles the page's own timers.
    startRecorder();
    void StarlinkNative.startRecorder({ status: "Recording your Starlink" }).catch(() => {});
    void StarlinkNative.addListener("tick", fireDueAlarms).catch(() => {});
    void StarlinkNative.requestNotificationPermission().catch(() => {});
    startSampler();
    return bindNotifications();
  })
  .finally(() => {
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });

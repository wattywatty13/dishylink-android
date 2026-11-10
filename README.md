# Dishylink for Android (unofficial port)

An Android app for monitoring your Starlink dish and router: live speed, latency, obstructions,
the 3D satellite sky view, speed tests, dish alignment, data usage, alerts and background
history recording.

It is a port of **[Dishylink](https://github.com/DaveyHert/dishylink)** by daveyhert, which
runs on Windows, macOS and as a browser extension. Nearly all of the app is Dishylink's own code;
this fork wraps it for Android and adapts the layout for phones. The original project's README
is kept in [README.upstream.md](README.upstream.md).

> [!WARNING]
> **This Android port was written by an AI.** The Android-specific code (the Capacitor shell,
> native Java layer, browser-API stand-in, phone layout and build setup) was written by
> Anthropic's Claude (Claude Code, model Claude Opus 5.5) working from a user's requests and
> feedback. It has passed the project's automated tests and has been used on one phone (a
> Samsung Galaxy S25 Ultra), but it has **not** been reviewed line by line by a human
> developer. Use it at your own risk, and read the code before you trust it with your
> Starlink account.

> [!NOTE]
> Not affiliated with, endorsed by, or sponsored by SpaceX or Starlink, and not an official
> Dishylink release. Please don't send bug reports about the Android port to the upstream
> project. See [DISCLAIMER.md](DISCLAIMER.md) and [PRIVACY.md](PRIVACY.md).

- **Version:** 0.4.0 (debug build). See [CHANGELOG-ANDROID.md](CHANGELOG-ANDROID.md).
- **Requires:** Android 6.0 (API 23) or newer, and the phone on your Starlink Wi-Fi.
- **License:** MIT, the same as upstream ([LICENSE](LICENSE)).

---

## Contents

- [Features](#features)
- [How the port works](#how-the-port-works)
- [Building the APK from source](#building-the-apk-from-source)
- [Installing on a phone](#installing-on-a-phone)
- [Developing without a dish](#developing-without-a-dish)
- [Tests and checks](#tests-and-checks)
- [Known limitations](#known-limitations)
- [What changed in the shared code](#what-changed-in-the-shared-code)

---

## Features

Everything the desktop app and browser extension do, on a phone:

- **Dashboard:** live download/upload, latency, packet loss, uptime, obstruction map, events.
- **Satellite view:** the 3D sky with live Starlink satellites (orbits from celestrak.org),
  drag to orbit and pinch to zoom.
- **Speed test** (Cloudflare), **Alignment** helper, **Network** devices, **Data usage**.
- **Starlink account:** sign in to starlink.com inside the app to see plan and usage data.
- **Alerts:** Android notifications for outages, obstructions and other dish alerts.
- **Background recording:** a foreground service keeps history recording while the app is in
  the background ("Recording your Starlink" notification, with a *Stop and close* button).
- **Phone layout:** a ☰ menu in place of the desktop dock, two-column stat tiles, and screens
  sized for portrait. Landscape and tablets keep the desktop layout.

## How the port works

Dishylink is built so the same React app (`src/`) can run on different "hosts". The desktop
app and the browser extension each plug in their own way of reaching the dish. The Android
app reuses the **browser extension's** host code and background recorder, and supplies the
pieces a browser normally would:

| Piece | File | What it does |
| --- | --- | --- |
| Entry point | `mobile/main.tsx` | Binds the shared app to the extension's host modules, starts the extension's background recorder in the same page, starts the native recorder service. |
| Browser API stand-in | `mobile/shim/browser.ts` | Implements the parts of the WebExtension API the extension code uses (storage, messaging, alarms, notifications, cookies, header rules) on top of the WebView and the native plugin. `vite.mobile.config.ts` aliases `wxt/browser` and `#imports` to it. |
| Native networking | `mobile/nativeFetch.ts` | Routes dish and router traffic (plain HTTP on the LAN), starlink.com and celestrak.org through native HTTP. This avoids CORS and mixed-content blocks and leaves out the Origin/Referer headers, which the dish rejects. The speed test stays on the WebView's normal fetch. |
| Native plugin | `android/app/src/main/java/com/dishylink/android/StarlinkNativePlugin.java` | HTTP, reading sign-in cookies, notifications, starting/stopping the recorder. |
| Recorder service | `.../RecorderService.java` | Foreground service that ticks the recorder every 30 s. The dish keeps about 15 minutes of history, so a late tick catches up rather than losing data. |
| Starlink sign-in | `.../SignInActivity.java` | starlink.com in an in-app browser screen. You sign in yourself; the app reads the session cookie from Android's cookie store. Your password never passes through the app's code. |
| Main screen | `.../MainActivity.java` | Hosts the WebView, dark system bars, Back button behaviour. |

No new polling was added: the app makes the same dish and router requests as the browser
extension, and never calls the router's `get_ping` (see [CLAUDE.md](CLAUDE.md)).

---

## Building the APK from source

These are the exact steps used to build the published APK, on Windows 11. The same steps
work on macOS and Linux with the usual path and shell changes.

### 1. Install the tools

| Tool | Version used | Notes |
| --- | --- | --- |
| Git | 2.50 | |
| Node.js | 22.15.1 (npm 10.9.2) | Node 20 or newer should work. |
| JDK | **21** (Eclipse Temurin 21) | Capacitor 7 requires JDK 21; JDK 17 fails with `invalid source release: 21`. |
| Android SDK | platform-tools, `platforms;android-35`, `build-tools;36.0.0` | Gradle downloads any missing SDK parts on first build if the licences are accepted. |

You don't need Android Studio. The SDK command-line tools are enough:

1. Download Temurin JDK 21 (zip) from [adoptium.net](https://adoptium.net) and unzip it, for
   example to `%LOCALAPPDATA%\jdk21`.
2. Download the Android **command-line tools** from
   [developer.android.com/studio](https://developer.android.com/studio#command-tools) and unzip
   them to `%LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest`.
3. Install the SDK packages and accept the licences:

   ```powershell
   $env:JAVA_HOME   = "$env:LOCALAPPDATA\jdk21"
   $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
   & "$env:ANDROID_HOME\cmdline-tools\latest\bin\sdkmanager.bat" "platform-tools" "platforms;android-35" "build-tools;36.0.0"
   & "$env:ANDROID_HOME\cmdline-tools\latest\bin\sdkmanager.bat" --licenses
   ```

> **Long paths on Windows:** clone into a short folder (for example `Z:\dev` or `C:\src`).
> Cloning deep inside your user profile can fail with `Filename too long`.

### 2. Get the code and install dependencies

```powershell
git clone <this repository's URL> starlink-android
cd starlink-android
npm install
```

`npm install` also runs `wxt prepare` (the browser-extension tooling), which the Android build
needs because it reuses the extension's code.

### 3. Build the web bundle and copy it into the Android project

```powershell
npx vite build --config vite.mobile.config.ts
npx cap sync android
```

or simply `npm run build:android`. This builds the dashboard from `mobile/` (which pulls in
`src/`, `core/` and `extension/`) into `dist-mobile/`, then Capacitor copies it into
`android/app/src/main/assets/public`.

### 4. Build the APK with Gradle

```powershell
cd android
$env:JAVA_HOME    = "$env:LOCALAPPDATA\jdk21"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
.\gradlew.bat assembleDebug
cd ..
```

(On macOS/Linux: `export JAVA_HOME=...; export ANDROID_HOME=...; ./gradlew assembleDebug`.)
`npm run apk:android` runs the same Gradle task if `JAVA_HOME` and `ANDROID_HOME` are already
set. You can also put `sdk.dir=...` in `android/local.properties` instead of `ANDROID_HOME`.

The first build downloads Gradle and the Android libraries and takes a few minutes. The result is:

```
android/app/build/outputs/apk/debug/app-debug.apk   (about 5.7 MB)
```

The published file `Dishylink-android-debug.apk` is that file, renamed.

### Release builds

The APK above is **debug-signed**: fine for installing on your own phone, not for the Play
Store. For a release build, create a keystore, add a `signingConfigs` block to
`android/app/build.gradle`, and run `.\gradlew.bat assembleRelease`. Never commit the keystore.

---

## Installing on a phone

1. Copy the APK to the phone (USB, cloud drive, email to yourself) and open it. Android will
   ask you to allow your file manager or browser to *install unknown apps*.
   Or, with USB debugging on: `adb install -r Dishylink-android-debug.apk`.
2. Connect the phone to your **Starlink Wi-Fi** (the app talks to the dish at `192.168.100.1`
   and the router at `192.168.1.1`).
3. Open Dishylink and allow notifications if you want alerts.
4. Optional: in the menu, open **Account** and sign in to starlink.com to see plan and usage.

To update, install the new APK over the old one. Your settings and history are kept.

---

## Developing without a dish

`dev/fakeDish.mts` is a small fake dish and router that answers the app's requests with
believable data, so you can work on the layout away from a Starlink connection:

```powershell
npx tsx dev/fakeDish.mts                                # fake dish on :9201, router on :9001
npx vite --config vite.mobile.config.ts                 # dev server on http://localhost:5180
```

Open `http://localhost:5180`, run `localStorage.fakeDish = "1"` in the browser console and
reload. Use the browser's device toolbar at a phone width (for example 412 × 915) to see the
phone layout. The fake dish is used only by the development server, never in the APK.

To debug the real app on a phone, `webContentsDebuggingEnabled` is on in debug builds: open
`chrome://inspect` on a computer with the phone connected by USB.

---

## Tests and checks

```powershell
npm run test:android        # unit tests for the browser-API stand-in and native-fetch routing
npm run typecheck:android   # TypeScript check of mobile/
npx tsc -b                  # TypeScript check of the shared app
npm run lint
npx vitest run --project node   # the upstream test suite (1,144 tests at the time of 0.4.0)
```

All of these passed for 0.4.0. The upstream browser-based tests (Playwright) were not run.

---

## Known limitations

- **Background recording.** Recording continues while the app is in the background (Back sends
  it there). Swiping it away from Recents, or *Stop and close* on the notification, stops it.
  Some phone makers close background apps aggressively; set the app's battery use to
  *Unrestricted* if your history has gaps.
- **This device.** Android hides the phone's Wi-Fi MAC address, so, as in the browser
  extension, pick which device is this phone in the device list to get accurate self-usage.
- **Tested hardware.** Used on a Samsung Galaxy S25 Ultra only. Layout was also checked in a
  browser at 384 and 412 px wide.
- **Debug build.** See [Release builds](#release-builds).

---

## What changed in the shared code

The Android work is mostly new files (`mobile/`, `android/`, `vite.mobile.config.ts`,
`capacitor.config.json`, `dev/fakeDish.mts`). Changes to the shared app in `src/` are
limited to phone-only styling (Tailwind `max-sm:` classes, which only apply below 640 px) and
a few Android-only switches keyed off `data-host="android"`:

- `src/components/toolbar/ToolbarMenu.tsx` (new) and `src/lib/phoneMenu.ts` (new): the ☰ menu.
- `src/components/satellite/skyCamera.ts`: pinch-to-zoom on touch screens.
- `src/components/satellite/SatelliteView.tsx`: phone layout and the ⓘ details toggle.
- Dashboard, top bar, stat tiles, modals: phone spacing and sizes.
- `core/i18n/locales/*.json`: four new strings (menu "Dashboard", touch hint, show/hide details).
- `src/lib/storeReview.ts`: no "review us" prompt on Android.

Desktop, landscape and browser-extension behaviour is unchanged.

## Credits

- **Dishylink** © daveyhert, MIT licence: the dashboard, dish client, recorder and nearly
  everything you see. <https://github.com/DaveyHert/dishylink>
- **Android port:** written by Claude (Anthropic) in Claude Code, directed and tested by the
  repository owner.
- [Capacitor](https://capacitorjs.com) by Ionic, for the Android shell.

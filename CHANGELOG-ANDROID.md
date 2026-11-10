# Changelog: Dishylink for Android

Changes to the Android port only. For the dashboard itself, see the upstream
[CHANGELOG.md](CHANGELOG.md). All versions are debug builds, written by Claude (Anthropic)
and tested on a Samsung Galaxy S25 Ultra. Based on upstream Dishylink 1.3.1.

## [0.4.0] - 2026-11-10

Satellite view for phones.

### Added

- Pinch-to-zoom in the 3D satellite view and on the dashboard's obstruction dome. Before,
  zooming needed a mouse wheel. One finger still rotates.
- An ⓘ button in the satellite view that shows or hides the details card (site, obstruction,
  satellites overhead, likely serving satellite). On a phone the card starts hidden so the sky
  gets the screen.

### Changed

- Satellite view controls sit in one row along the top, with larger (40 px) buttons, and no
  longer collide with the title.
- The hint reads "Drag to orbit · Pinch to zoom" on touch screens, instead of the desktop
  "Scroll to zoom · Esc to close", and no longer overlaps the legend.
- The time-lapse slider fits the screen width and sits above the legend; the legend wraps
  onto two lines.
- Dashboard header: solid background, so charts no longer show through it when scrolling. The
  connection state is shown by the coloured dot alone, so the full "Dishylink" name fits.
- "Live satellite view ›" on the obstruction card stays on one line.

## [0.3.0] - 2026-11-10

A real portrait layout.

### Changed

- Removed the 0.1.0 approach of laying the page out at 800 px and shrinking it. The app now
  lays out at the phone's real width with phone-specific sizes, so text and buttons are
  readable in portrait without rotating the phone.
- Dashboard stat tiles in two columns, with sparklines below the value; tighter page margins.
- Top bar: country and uptime readouts hidden on phones; larger icon buttons.
- Data usage and other detail panels fit the screen: smaller figures, no sideways overflow.

### Added

- `dev/fakeDish.mts`: a fake dish and router for layout work without Starlink hardware.

## [0.2.0] - 2026-11-09

Navigation you can reach.

### Changed

- The desktop bottom dock (Speed test, Alignment, Network, Data usage, Settings and so on) is
  replaced on Android by a ☰ menu button at the top left. It opens a side sheet with large
  52 px rows and a *Dashboard* entry to go back home.
- The app draws edge to edge with proper margins, so Android's navigation buttons no longer
  cover the app.
- The "toolbar style" setting is hidden on Android, since the menu replaces the dock.
- Dark system bars with light icons to match the app.

## [0.1.0] - 2026-11-09

First Android build.

### Added

- Capacitor 7 Android app running Dishylink's dashboard, with the browser extension's
  background recorder reused unchanged through a stand-in for the browser extension APIs.
- Native HTTP for the dish (192.168.100.1), router (192.168.1.1), starlink.com and
  celestrak.org, so LAN requests work without CORS, mixed-content or Origin-header problems.
- Background recording via a foreground service, with a *Stop and close* action on its
  notification; it shows the number of active alerts.
- Android notifications for dish alerts.
- Starlink account sign-in in an in-app browser screen.
- Back button returns within the app, then sends it to the background instead of closing it.
- The app-store review prompt is not shown on Android.

### Known issues (fixed in later versions)

- Laid out at 800 px and scaled down on phones, so everything was small in portrait.
- The bottom dock was hidden behind Android's navigation buttons.

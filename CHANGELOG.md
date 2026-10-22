# Changelog

This project follows Semantic Versioning. Dates are ISO 8601.

## 0.3.0 - 2026-10-22

### Added

- Snapshots carry `text`: up to 1500 characters of what the viewport shows, frames shown on it
  included, so a caller can read what a page says back after an action. Field values and
  editable regions are never read.

## 0.2.0 - 2026-10-22

Speaks protocol version 1, with the additions below. Load or reload this build: Chrome
keeps running the old service worker of an unpacked extension whose version did not change.

### Added

- `page.upload` puts a file in a file field, in the top document or a frame, after the host has
  sent it in chunks with `files.stage`: up to 10 MB, through the field's own input and change
  events, with no picker.
- Snapshots read the page's frames, cross-origin ones included. A frame's elements are
  named `f<frame>.e<n>`, placed in the top viewport by the frame's box, and clicked and typed
  into in their own frame; password and payment fields are refused there as everywhere.
- `tabs.open` takes `where: "background"`: the tab opens without being activated and its
  window is not focused, so the browser does not take the person's focus.

## 0.1.0 - 2026-09-23

The first release. It speaks protocol version 1 with hypruse's `browser-host`.

### Added

- A Manifest V3 service worker that connects to the native host `dev.hypruse.browser`, sends a
  hello first on every connection, and reconnects with backoff and a 30 second alarm.
- Tab operations: `tabs.list`, `tabs.activate`, `tabs.open` (http and https only),
  `tabs.close` and `tabs.history`, plus `sites.top` from Chrome's most visited sites.
- `page.snapshot`: named, visible and reachable elements in reading order, with search boxes
  recognised, repeated items numbered as lists, and an optional wait for the page to settle.
- `page.click`, `page.type` and `page.scroll`, which act only on the latest snapshot of a page
  and answer `stale_snapshot` once the page has moved on.
- Typing that refuses password and payment card fields. Snapshots never contain field values.
- `tabs.changed` events, at most one per tab every 200 ms.
- An extension ID pinned by a public key, `pcfjlemgcbbpppclachnobhnnnahpgoj`, checked on every
  build.
- Unit tests in jsdom and Playwright end to end tests in Chromium, including a full native
  messaging round trip through a stand-in host.

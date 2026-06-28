# Background notifications for new notes — design

**Date:** 2026-06-28
**Status:** Approved, ready for implementation planning

## Goal

When a new note is published, an installed-PWA user on a supporting browser
receives a local notification — with **no backend and no secrets**, staying
fully within mindbob's static-site hard constraints.

## Why not true Web Push

True Web Push would require three things the project deliberately excludes:

1. A push-subscription store (per-device endpoints kept server-side).
2. A VAPID private key — but the cron is constrained to only `GITHUB_TOKEN`,
   no external secrets.
3. A server to fire the push when `messages.json` changes.

Instead we use the **Periodic Background Sync API**: the service worker wakes
itself periodically, re-fetches `messages.json`, and shows a *local*
notification when it sees a newly-published entry. No server, no secrets, no
subscription store.

## Decisions (from brainstorming)

- Self-waking **local** notifications via Periodic Background Sync.
- Opt-in via a **🔔 bell toggle** in the existing top bar.
- Notification shows a **teaser + open**: the note's text as the body, slot in
  the title, click opens/focuses the app.
- On browsers without Periodic Background Sync support, the **bell is hidden
  entirely** — the bell always means real background push.

## Components

### 1. Detection & opt-in — new module `js/notify.js`

A new single-purpose module, wired from `main.js` like the other features
(keep modules small and single-purpose per the repo conventions).

On init, **feature-detect** support — all of:
- `"serviceWorker" in navigator`
- `"Notification" in window`
- `"periodicSync" in ServiceWorkerRegistration.prototype`

Behaviour:
- **Unsupported** → the bell stays hidden. No dead control.
- **Supported** → render a 🔔 toggle in `.topbar`, right side (opposite the
  brand). State is **derived, not separately stored**:
  - "on" = `Notification.permission === "granted"` **and** our periodic-sync
    tag is registered (`registration.periodicSync.getTags()` contains
    `mindbob-check`).

Click handling:
- **Bell off → on:** call `Notification.requestPermission()` (the click is the
  required user gesture); if granted, `registration.periodicSync.register(
  "mindbob-check", { minInterval: 12 * 60 * 60 * 1000 })`. Then **seed** the
  last-notified id with the currently-shown note's id so we do not immediately
  notify for a note the user is already looking at.
- **Bell on → off:** `registration.periodicSync.unregister("mindbob-check")`.

The bell reflects the resulting state (aria-pressed, active class) after each
action and on init.

### 2. Background check — additions to `sw.js`

- A `periodicsync` event listener for tag `mindbob-check` → runs
  `checkForNewNote()` inside `event.waitUntil(...)`.
- `checkForNewNote()`:
  1. Network-fetch `./data/messages.json` (bypass cache for freshness).
  2. Pick the newest entry whose `publishAt <= now` using a small selection
     helper. The SW is a **classic** worker and cannot cleanly import the ES
     module, so this helper is **duplicated** (~5 lines) in `sw.js` with a
     comment naming `js/messages.js` `selectCurrent()` as the source of truth.
  3. Read the stored **last-notified id**. If the selected entry's `id`
     differs → `self.registration.showNotification(...)` and store the new id.
- **Last-notified id storage:** `localStorage` is unavailable in a service
  worker, so store it in a dedicated `mindbob-meta` cache under a synthetic
  request key (e.g. `new Request("mindbob-last-notified")` → a `Response`
  whose body is the id). Read/write wrapped in try/catch.
- A `notificationclick` listener → `event.notification.close()`, then focus an
  existing app window via `clients.matchAll({ type: "window" })` if one is
  open, else `clients.openWindow(...)` to the app scope.

### 3. The notification

- **Title:** slot-aware, mirroring the in-app status line —
  `"mindbob · morning note"` (am) / `"mindbob · evening note"` (pm).
- **Body:** the note's `text`.
- **Icon:** `./icons/icon-192.png`.
- **Tag:** `mindbob-note` so a newer note replaces an older unread one rather
  than stacking.
- **Click:** opens/focuses the app.

## Honest limitations (to document in CLAUDE.md)

- Chromium / Android with the PWA installed only; the bell is hidden
  everywhere else (iOS Safari, desktop Firefox/Safari, uninstalled).
- The browser decides *when* periodic sync fires — notifications arrive within
  the browser's background window of publish time, not at the exact minute.
  `minInterval` is a floor, not a guarantee.

## Testing

- **Selection helper parity:** assert the SW's duplicated selection logic and
  `js/messages.js` `selectCurrent()` agree on shared fixtures (newest past
  entry; all-future falls back to oldest).
- **Manual / DevTools Protocol:** trigger the `periodicsync` event from
  DevTools (Application → Service Workers → Periodic Sync) and verify:
  - a notification fires once for a new note;
  - re-triggering with the same data does **not** re-notify (dedup via
    last-notified id);
  - clicking the notification focuses an open tab / opens a new one.
- **Bell state:** with permission granted + tag registered the bell reads
  "on"; after unregister it reads "off"; on an unsupported browser the bell is
  absent.

## Out of scope

- True Web Push / cross-browser delivery.
- Foreground "you missed a note" catch-up (considered and rejected; bell is
  hidden on unsupported browsers instead).
- Per-slot notification preferences or quiet hours.

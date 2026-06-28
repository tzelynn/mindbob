# Background notifications for new notes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a new note is published, an installed-PWA user on a supporting browser gets a local notification — with no backend and no secrets.

**Architecture:** The service worker registers a Periodic Background Sync task. When the browser wakes it, the SW re-fetches `data/messages.json`, selects the current published note, and shows a local notification if that note differs from the last one it notified about. A 🔔 toggle in the top bar is the opt-in, shown only where the API is supported. The note-selection logic is extracted into one pure module so the page and the SW agree on which note is "current".

**Tech Stack:** Vanilla ES modules (browser), classic service worker, Cache Storage API for cross-context state, Node's built-in `node:test` runner for unit tests (no npm dependencies installed).

## Global Constraints

Copied verbatim from the spec and CLAUDE.md — every task must honor these:

- **No framework, no build step, no bundler, no npm dependencies for the site.** Vanilla HTML/CSS/JS, ES modules, served as-is.
- **All paths are relative** (`./js/...`, `./data/...`). Absolute paths break the project-subpath deployment.
- **The cron uses only `GITHUB_TOKEN`.** This feature adds **no** secrets and **no** changes to the cron/pipeline.
- **No `Math.random()` for visuals.** (Not relevant here, but unchanged.)
- **`.toolbar[hidden]` / any element given a `display` and toggled via `hidden` needs an explicit `display:none` rule** so the author rule doesn't override the `hidden` attribute.
- **Service worker must stay self-consistent across updates** — version-scoped caches, no `clients.claim()`. Don't change that contract.
- **Notification copy:** title is slot-aware mirroring the in-app status line — `"mindbob · morning note"` (am) / `"mindbob · evening note"` (pm). Body is the note text. Icon `./icons/icon-192.png`. Notification tag `mindbob-note`.
- **Periodic-sync tag:** `mindbob-check`. **Min interval:** `12 * 60 * 60 * 1000` ms.
- **Shared cross-context state contract:** cache name `mindbob-meta`, key `https://mindbob.local/last-notified`. Used by both `sw.js` and `js/notify.js`.

---

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `js/selectEntry.js` | **create** | Pure `pickCurrentEntry(entries, nowMs)` — the single source of truth for "which entry is current". |
| `js/messages.js` | modify | Delegate selection to `pickCurrentEntry`; keep fetch + fallback concerns. |
| `sw.js` | modify | Add periodic-sync check, notification, click handler, meta-cache state, keep-list update; duplicate `pickCurrentEntry` (classic worker can't import). |
| `js/notify.js` | **create** | Feature-detect, render/toggle the 🔔 bell, request permission, register/unregister periodic sync, seed last-notified id. |
| `js/main.js` | modify | Look up the bell ref and call `initNotifications`. |
| `index.html` | modify | Add the `#notifyBell` button to the top bar. |
| `styles.css` | modify | Style the bell + its `[hidden]` rule. |
| `package.json` | **create** | `{ "private": true, "type": "module" }` — lets `node --test` import the browser `.js` modules as ESM. No dependencies, no scripts, no build. GitHub Pages ignores it. |
| `test/selectEntry.test.mjs` | **create** | Behavioral tests for `pickCurrentEntry` + `selectCurrent`. |
| `test/sw-selection.test.mjs` | **create** | Parity test: the copy of `pickCurrentEntry` in `sw.js` behaves identically to `js/selectEntry.js`. |
| `CLAUDE.md` | modify | Document the new module, invariants, and limitations. |
| `README.md` | modify | User-facing note about notifications + support. |

**Note on `package.json`:** This does **not** introduce a framework, build step, bundler, or any dependency — it is a two-field marker so Node treats the existing `.js` files as ES modules during tests. `node --test` uses only built-ins. The served site never requests it.

---

## Task 1: Pure selection module + tests

**Files:**
- Create: `package.json`
- Create: `js/selectEntry.js`
- Modify: `js/messages.js`
- Test: `test/selectEntry.test.mjs`

**Interfaces:**
- Produces: `pickCurrentEntry(entries, nowMs)` → returns the entry with the greatest `publishAt` that is `≤ nowMs`, or `null` if none qualify. `entries` is an array of `{ id, date, slot, publishAt, text, source }`; `nowMs` is a millisecond timestamp.
- Produces (unchanged signature): `selectCurrent(data, now = new Date())` and `getCurrentEntry(now)` from `js/messages.js`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "private": true,
  "type": "module"
}
```

- [ ] **Step 2: Write the failing test**

Create `test/selectEntry.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickCurrentEntry } from "../js/selectEntry.js";
import { selectCurrent } from "../js/messages.js";

const am = { id: "2026-06-28-am", slot: "am", publishAt: "2026-06-28T00:00:00Z", text: "morning" };
const pm = { id: "2026-06-28-pm", slot: "pm", publishAt: "2026-06-28T11:00:00Z", text: "evening" };
const tomorrowAm = { id: "2026-06-29-am", slot: "am", publishAt: "2026-06-29T00:00:00Z", text: "next" };

const ms = (iso) => new Date(iso).getTime();

test("picks the newest entry already published", () => {
  const chosen = pickCurrentEntry([am, pm, tomorrowAm], ms("2026-06-28T12:00:00Z"));
  assert.equal(chosen.id, "2026-06-28-pm");
});

test("ignores future entries", () => {
  const chosen = pickCurrentEntry([am, pm, tomorrowAm], ms("2026-06-28T05:00:00Z"));
  assert.equal(chosen.id, "2026-06-28-am");
});

test("returns null when nothing is published yet", () => {
  const chosen = pickCurrentEntry([am, pm], ms("2026-06-27T00:00:00Z"));
  assert.equal(chosen, null);
});

test("selectCurrent falls back to the oldest entry when all are in the future", () => {
  const data = { entries: [pm, am] };
  const chosen = selectCurrent(data, new Date("2026-06-27T00:00:00Z"));
  assert.equal(chosen.id, "2026-06-28-am"); // oldest by publishAt
});

test("selectCurrent picks the current published entry when one exists", () => {
  const data = { entries: [am, pm] };
  const chosen = selectCurrent(data, new Date("2026-06-28T12:00:00Z"));
  assert.equal(chosen.id, "2026-06-28-pm");
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test test/`
Expected: FAIL — `Cannot find module '../js/selectEntry.js'` (module not created yet).

- [ ] **Step 4: Create `js/selectEntry.js`**

```javascript
// Single source of truth for "which note is current".
// Pure: no DOM, no fetch, no service-worker globals — so it can be imported by
// js/messages.js (page) AND unit-tested in Node. sw.js keeps a byte-identical
// copy (it is a classic worker and cannot import ES modules); test/sw-selection
// .test.mjs asserts the two stay in parity.
//
// Returns the entry with the greatest publishAt that is <= nowMs, or null if no
// entry has been published yet.
export function pickCurrentEntry(entries, nowMs) {
  let chosen = null;
  let chosenMs = -Infinity;
  for (const e of entries) {
    const t = new Date(e.publishAt).getTime();
    if (t <= nowMs && t >= chosenMs) {
      chosen = e;
      chosenMs = t;
    }
  }
  return chosen;
}
```

- [ ] **Step 5: Refactor `js/messages.js` to delegate to it**

Add the import at the top (after the opening comment, before `FALLBACK_ENTRY`):

```javascript
import { pickCurrentEntry } from "./selectEntry.js";
```

Replace the existing `selectCurrent` function body (lines 29–39) with:

```javascript
// Pick the most recent entry whose publishAt is in the past.
// If every entry is in the future (e.g. freshly seeded data), show the oldest.
export function selectCurrent(data, now = new Date()) {
  const chosen = pickCurrentEntry(data.entries, now.getTime());
  if (chosen) return chosen;
  const sorted = [...data.entries].sort(
    (a, b) => new Date(a.publishAt) - new Date(b.publishAt)
  );
  return sorted[0] || FALLBACK_ENTRY;
}
```

Leave `FALLBACK_ENTRY`, `loadMessages`, and `getCurrentEntry` unchanged.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test test/`
Expected: PASS — 5 tests passing.

- [ ] **Step 7: Commit**

```bash
git add package.json js/selectEntry.js js/messages.js test/selectEntry.test.mjs
git commit -m "feat: extract pure pickCurrentEntry selection module

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Service worker background check

**Files:**
- Modify: `sw.js`
- Test: `test/sw-selection.test.mjs`

**Interfaces:**
- Consumes: the shared state contract (cache `mindbob-meta`, key `https://mindbob.local/last-notified`), periodic-sync tag `mindbob-check`.
- Produces (inside `sw.js`, used by Task 3 via the SW): a `periodicsync` handler that notifies on new notes; `notificationclick` focuses/opens the app. The duplicated `pickCurrentEntry` is wrapped in marker comments `// >>> selection-parity >>>` and `// <<< selection-parity <<<` so the parity test can extract it.

- [ ] **Step 1: Write the failing parity test**

Create `test/sw-selection.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pickCurrentEntry } from "../js/selectEntry.js";

// Extract the SW's duplicated pickCurrentEntry between the marker comments and
// build a callable function from it — no SW globals are referenced inside it.
async function loadSwPick() {
  const src = await readFile(new URL("../sw.js", import.meta.url), "utf8");
  const m = src.match(/\/\/ >>> selection-parity >>>([\s\S]*?)\/\/ <<< selection-parity <<</);
  assert.ok(m, "sw.js must contain the selection-parity marker block");
  const block = m[1];
  // The block defines `function pickCurrentEntry(...)`; return it.
  return new Function(block + "\nreturn pickCurrentEntry;")();
}

const entries = [
  { id: "a", publishAt: "2026-06-28T00:00:00Z" },
  { id: "b", publishAt: "2026-06-28T11:00:00Z" },
  { id: "c", publishAt: "2026-06-29T00:00:00Z" },
];
const cases = [
  "2026-06-27T00:00:00Z",
  "2026-06-28T05:00:00Z",
  "2026-06-28T12:00:00Z",
  "2026-06-29T06:00:00Z",
];

test("sw.js pickCurrentEntry matches js/selectEntry.js on all fixtures", async () => {
  const swPick = await loadSwPick();
  for (const iso of cases) {
    const ms = new Date(iso).getTime();
    const expected = pickCurrentEntry(entries, ms);
    const actual = swPick(entries, ms);
    assert.deepEqual(
      actual && actual.id,
      expected && expected.id,
      `mismatch at ${iso}`
    );
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/sw-selection.test.mjs`
Expected: FAIL — assertion "sw.js must contain the selection-parity marker block" (markers not added yet).

- [ ] **Step 3: Bump the SW version and add the meta cache constant**

In `sw.js`, change the version line and add the meta-cache name:

```javascript
const VERSION = "v6";
const SHELL_CACHE = `mindbob-shell-${VERSION}`;
const RUNTIME_CACHE = `mindbob-runtime-${VERSION}`;
// Unversioned: holds the id of the last note we notified about. Must survive
// version bumps, so it is excluded from the activate() cleanup below.
const META_CACHE = "mindbob-meta";
const LAST_NOTIFIED_KEY = "https://mindbob.local/last-notified";
const PERIODIC_TAG = "mindbob-check";
```

- [ ] **Step 4: Keep the meta cache across activations**

In the `activate` handler, update the filter so `META_CACHE` is not deleted. Replace:

```javascript
            .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
```

with:

```javascript
            .filter(
              (k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE && k !== META_CACHE
            )
```

- [ ] **Step 5: Add the selection copy, state helpers, check, and handlers**

Append to the end of `sw.js`:

```javascript
// >>> selection-parity >>>
// EXACT copy of pickCurrentEntry from js/selectEntry.js. This is a classic
// worker and cannot import ES modules; test/sw-selection.test.mjs asserts the
// two stay identical in behavior. If you change one, change the other.
function pickCurrentEntry(entries, nowMs) {
  let chosen = null;
  let chosenMs = -Infinity;
  for (const e of entries) {
    const t = new Date(e.publishAt).getTime();
    if (t <= nowMs && t >= chosenMs) {
      chosen = e;
      chosenMs = t;
    }
  }
  return chosen;
}
// <<< selection-parity <<<

async function getLastNotifiedId() {
  try {
    const cache = await caches.open(META_CACHE);
    const res = await cache.match(LAST_NOTIFIED_KEY);
    return res ? await res.text() : null;
  } catch {
    return null;
  }
}

async function setLastNotifiedId(id) {
  try {
    const cache = await caches.open(META_CACHE);
    await cache.put(LAST_NOTIFIED_KEY, new Response(id));
  } catch {
    /* storage unavailable — degrade silently */
  }
}

function titleFor(entry) {
  return entry.slot === "pm" ? "mindbob · evening note" : "mindbob · morning note";
}

// Fetch the latest notes, pick the current one, and notify if it's new.
async function checkForNewNote() {
  let data;
  try {
    const res = await fetch("./data/messages.json", { cache: "no-store" });
    if (!res.ok) return;
    data = await res.json();
  } catch {
    return;
  }
  if (!data || !Array.isArray(data.entries)) return;

  const entry = pickCurrentEntry(data.entries, Date.now());
  if (!entry) return;

  const last = await getLastNotifiedId();
  if (entry.id === last) return;

  await setLastNotifiedId(entry.id);
  await self.registration.showNotification(titleFor(entry), {
    body: entry.text,
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    tag: "mindbob-note",
    data: { url: self.registration.scope },
  });
}

self.addEventListener("periodicsync", (event) => {
  if (event.tag === PERIODIC_TAG) {
    event.waitUntil(checkForNewNote());
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url =
    (event.notification.data && event.notification.data.url) ||
    self.registration.scope;
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of all) {
        if ("focus" in client) {
          client.focus();
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(url);
    })()
  );
});
```

- [ ] **Step 6: Run the parity test to verify it passes**

Run: `node --test test/`
Expected: PASS — all tests from Task 1 and the parity test pass.

- [ ] **Step 7: Commit**

```bash
git add sw.js test/sw-selection.test.mjs
git commit -m "feat: service-worker periodic check + notification for new notes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Bell toggle + opt-in module

**Files:**
- Create: `js/notify.js`
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `js/main.js`

**Interfaces:**
- Consumes: the bell `<button>` element, and `state.entry.id` (from `main.js`). The shared state contract (cache `mindbob-meta`, key `https://mindbob.local/last-notified`), tag `mindbob-check`, min interval `12 * 60 * 60 * 1000`.
- Produces: `initNotifications(bell, state)` → `Promise<void>`. No return value; wires the bell.

This task's deliverable is browser-runtime behavior that needs DOM + Service Worker + Notification APIs unavailable in `node:test` (and the no-dependencies constraint rules out jsdom). It is verified by the headless-Chrome / DevTools-Protocol procedure in Step 6, per CLAUDE.md's "Verifying UI changes".

- [ ] **Step 1: Add the bell button to `index.html`**

In the `.topbar` (`index.html` lines 24–30), add the bell as the last child, after the `.mode-toggle` `</div>`:

```html
      <div class="mode-toggle" role="tablist" aria-label="Display mode">
        <button id="modeMessage" class="mode-btn is-active" role="tab" aria-selected="true">message</button>
        <button id="modeDoodle" class="mode-btn" role="tab" aria-selected="false">doodle</button>
      </div>
      <button id="notifyBell" class="notify-bell" type="button" aria-pressed="false" aria-label="Notify me of new notes" title="Notify me of new notes" hidden>🔔</button>
```

- [ ] **Step 2: Style the bell in `styles.css`**

Add after the `.mode-btn.is-active` rule (after line 87):

```css
.notify-bell {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 1.1rem;
  line-height: 1;
  padding: 6px 8px;
  border-radius: 999px;
  cursor: pointer;
  transition: color 200ms ease, opacity 200ms ease;
}

.notify-bell.is-active {
  color: var(--ink);
}

.notify-bell:disabled {
  opacity: 0.5;
  cursor: progress;
}

/* The button has no explicit display, so the hidden attribute hides it
   natively; this rule makes that intent explicit and immune to future display
   rules (same trap as .toolbar[hidden]). */
.notify-bell[hidden] {
  display: none;
}
```

- [ ] **Step 3: Create `js/notify.js`**

```javascript
// Opt-in background notifications for newly published notes.
// Shows a bell toggle ONLY where Periodic Background Sync can deliver
// (Chromium + installed PWA); hidden everywhere else, so the bell always means
// real background push. See sw.js for the periodicsync handler and
// docs/superpowers/specs/2026-06-28-push-notifications-design.md for rationale.

const PERIODIC_TAG = "mindbob-check";
const MIN_INTERVAL = 12 * 60 * 60 * 1000;
// Shared with sw.js — keep in sync.
const META_CACHE = "mindbob-meta";
const LAST_NOTIFIED_KEY = "https://mindbob.local/last-notified";

function supported() {
  return (
    "serviceWorker" in navigator &&
    "Notification" in window &&
    "PeriodicSyncManager" in window
  );
}

async function setLastNotifiedId(id) {
  try {
    const cache = await caches.open(META_CACHE);
    await cache.put(LAST_NOTIFIED_KEY, new Response(id));
  } catch {
    /* storage unavailable — degrade silently */
  }
}

async function isEnabled(reg) {
  if (Notification.permission !== "granted") return false;
  try {
    const tags = await reg.periodicSync.getTags();
    return tags.includes(PERIODIC_TAG);
  } catch {
    return false;
  }
}

function reflect(bell, on) {
  bell.classList.toggle("is-active", on);
  bell.setAttribute("aria-pressed", String(on));
  const label = on ? "Notifications on — tap to turn off" : "Notify me of new notes";
  bell.setAttribute("aria-label", label);
  bell.title = label;
}

async function enable(reg, currentId) {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return;
  try {
    await reg.periodicSync.register(PERIODIC_TAG, { minInterval: MIN_INTERVAL });
  } catch {
    return; // browser refused (e.g. insufficient site engagement)
  }
  // Seed so the first check doesn't notify for the note already on screen.
  await setLastNotifiedId(currentId);
}

async function disable(reg) {
  try {
    await reg.periodicSync.unregister(PERIODIC_TAG);
  } catch {
    /* ignore */
  }
}

export async function initNotifications(bell, state) {
  if (!bell || !supported()) return; // bell stays hidden via the [hidden] attr

  const reg = await navigator.serviceWorker.ready;
  bell.hidden = false;
  reflect(bell, await isEnabled(reg));

  bell.addEventListener("click", async () => {
    bell.disabled = true;
    try {
      if (await isEnabled(reg)) {
        await disable(reg);
      } else {
        await enable(reg, state.entry.id);
      }
      reflect(bell, await isEnabled(reg));
    } finally {
      bell.disabled = false;
    }
  });
}
```

- [ ] **Step 4: Wire it into `js/main.js`**

Add the import after the existing imports (after line 7):

```javascript
import { initNotifications } from "./notify.js";
```

Add the bell to `refs` (inside the `refs` object, after `doodleWord`):

```javascript
  notifyBell: document.getElementById("notifyBell"),
```

Call it at the end of `init()`, right after `registerSW();`:

```javascript
  registerSW();
  initNotifications(refs.notifyBell, state);
```

- [ ] **Step 5: Smoke-test the module loads (no crash on unsupported headless run)**

Run a quick headless load to confirm `main.js` still initializes and the bell stays hidden where the API is absent. Headless Chrome has no `PeriodicSyncManager`, so the bell must remain hidden and the page must render normally.

```bash
cd "/mnt/c/Users/tze lynn/Documents/Coding/mindbob"
python3 -m http.server 8765 &
SERVER=$!
sleep 1
chromium --headless --no-sandbox --disable-gpu \
  --screenshot=/home/$USER/mindbob-notify.png --window-size=900,700 \
  http://localhost:8765/index.html
kill $SERVER
```

Expected: command exits 0; `/home/$USER/mindbob-notify.png` shows the normal message view with **no** bell (unsupported headless context). (Per CLAUDE.md, write screenshots under `/home/<user>/`, not the scratchpad.)

- [ ] **Step 6: Verify the bell + notification path via DevTools Protocol**

This confirms the supported-browser path (bell visible, permission, periodic-sync registration, notification). Drive Chrome over the DevTools Protocol as CLAUDE.md prescribes.

1. Launch Chrome with remote debugging and a notifications grant for the origin:

```bash
chromium --headless --no-sandbox --disable-gpu \
  --remote-debugging-port=9222 \
  --user-data-dir=/home/$USER/mindbob-chrome-profile \
  http://localhost:8765/index.html &
```

(Start `python3 -m http.server 8765` first if not already running.)

2. Using Node's global `fetch`/`WebSocket` against `http://localhost:9222/json`, connect to the page target and:
   - `Browser.grantPermissions` for `periodicBackgroundSync` and `notifications` on `http://localhost:8765`.
   - Evaluate `!!document.getElementById('notifyBell') && !document.getElementById('notifyBell').hidden` — note that in headless Chrome `PeriodicSyncManager` may still be absent; if so, document that the visible-bell path requires a real Chromium profile / installed PWA and was verified manually instead.
   - If supported: `Input.dispatchMouseEvent` a click on the bell's coordinates, then evaluate `document.getElementById('notifyBell').getAttribute('aria-pressed')` and assert `"true"`.
   - Trigger the background check: evaluate
     `navigator.serviceWorker.ready.then(r => r.periodicSync.getTags())` and assert it contains `mindbob-check`.

3. Manual notification check (most reliable): in a real Chromium with the app installed as a PWA, open DevTools → Application → Service Workers → Periodic Sync, enter tag `mindbob-check`, click the play/trigger button, and confirm one notification appears. Trigger again with unchanged `messages.json` and confirm **no** second notification (dedup via last-notified id). Click the notification and confirm the app focuses/opens.

Record the outcome of each check. If headless cannot exercise the visible-bell path, the parity/selection tests (Tasks 1–2) plus the manual PWA trigger in sub-step 3 are the authoritative verification.

- [ ] **Step 7: Commit**

```bash
git add js/notify.js js/main.js index.html styles.css
git commit -m "feat: bell toggle to opt into new-note notifications

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Update the module map in `CLAUDE.md`**

In the "Module map" table, add these rows (place `selectEntry.js` near `messages.js`, `notify.js` near `pwa.js`):

```markdown
| `js/selectEntry.js` | Pure current-note selection (shared by page + SW) | `pickCurrentEntry(entries, nowMs)` |
| `js/notify.js` | Bell toggle + Periodic Background Sync opt-in | `initNotifications(bell, state)` |
```

- [ ] **Step 2: Add a "Notifications" subsection under "Architecture" in `CLAUDE.md`**

Add after the `data/messages.json` contract description:

```markdown
### Notifications (opt-in, no backend)

A 🔔 toggle (`js/notify.js`) lets users opt into local notifications for new
notes. There is **no push server**: the service worker registers a Periodic
Background Sync task (`mindbob-check`, min interval 12h); when the browser wakes
it, `checkForNewNote()` re-fetches `messages.json`, selects the current note via
`pickCurrentEntry`, and shows a notification if its `id` differs from the last
one stored. Selection logic lives once in `js/selectEntry.js`; `sw.js` keeps a
byte-identical copy (classic workers can't import ES modules) guarded by the
`test/sw-selection.test.mjs` parity test.

Invariants:
- **The bell is hidden where Periodic Background Sync is unsupported** (iOS
  Safari, desktop Firefox/Safari, uninstalled PWA) — it always means real
  background push. Don't add a foreground fallback.
- **Cross-context state** (the last-notified note id) lives in the **unversioned
  `mindbob-meta` cache** under key `https://mindbob.local/last-notified`, written
  by both `js/notify.js` (seed on enable) and `sw.js` (on notify). It is
  **excluded from the `activate()` cache cleanup** — adding a versioned cache to
  that keep-list logic must not drop `META_CACHE`.
- **Notification copy** mirrors the in-app status line: title `mindbob · morning
  note` / `mindbob · evening note`, body = note text, tag `mindbob-note`.
- Limitation: the browser decides *when* periodic sync fires — notifications
  arrive within its background window of publish time, not at the exact minute.
```

- [ ] **Step 3: Add the test command to `CLAUDE.md`**

In the "Commands" section, add under the local-preview block:

```markdown
# run unit tests (selection logic + SW parity; Node built-in runner, no deps)
node --test test/
```

- [ ] **Step 4: Add a user-facing note to `README.md`**

Add a short "Notifications" subsection (match the README's existing tone/heading style) explaining: tap the 🔔 in the top bar to get notified of new notes; available on Chromium-based browsers / Android with the app installed; the timing follows the browser's background schedule.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: document opt-in background notifications

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Detection & opt-in module (`js/notify.js`) → Task 3. ✓
- Feature-detect 3 APIs, bell hidden when unsupported → Task 3, Step 3 (`supported()`) + Step 2 (`[hidden]`). ✓
- Bell in top bar, derived on/off state → Task 3, Steps 1 & 3 (`isEnabled`). ✓
- Request permission + register periodic sync on enable, unregister on disable → Task 3, Step 3. ✓
- Seed last-notified id on enable → Task 3, Step 3 (`enable` → `setLastNotifiedId`). ✓
- SW `periodicsync` → `checkForNewNote`, network fetch, select, dedup, notify → Task 2, Step 5. ✓
- Selection helper duplicated with source-of-truth comment + parity → Task 1 (`selectEntry.js`) + Task 2 (copy + `test/sw-selection.test.mjs`). ✓
- Last-notified id in `mindbob-meta` cache, try/catch, excluded from cleanup → Task 2, Steps 3–5. ✓
- `notificationclick` focus/open → Task 2, Step 5. ✓
- Notification title/body/icon/tag → Task 2, Step 5 (`titleFor`, `showNotification`). ✓
- Limitations documented in CLAUDE.md → Task 4, Step 2. ✓
- Selection-parity + behavioral tests → Tasks 1 & 2. ✓
- Out of scope (web push, foreground catch-up, prefs) → not implemented. ✓

**Placeholder scan:** No TBD/TODO; all code blocks complete; the only non-automated verification (Task 3, Step 6) is inherent to browser-only APIs under the no-dependencies constraint and gives concrete procedure + a documented authoritative fallback.

**Type consistency:** `pickCurrentEntry(entries, nowMs)` identical in `js/selectEntry.js`, the `sw.js` copy, and both tests. `initNotifications(bell, state)` defined in Task 3 and called in `main.js` with `(refs.notifyBell, state)`. Constants `META_CACHE`, `LAST_NOTIFIED_KEY`, `PERIODIC_TAG`, min interval `12 * 60 * 60 * 1000` consistent across `sw.js` and `js/notify.js`.

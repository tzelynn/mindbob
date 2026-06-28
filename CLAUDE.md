# CLAUDE.md

Guidance for working in the **mindbob** repo. Read `README.md` for user-facing setup; this file is the working context.

## What this is

A calming wellness micro-site: a feel-good note refreshed twice a day (lighthearted AM / reflective PM). Static site on GitHub Pages + a GitHub Actions cron that generates the notes. Installable as a PWA ("widget").

## Hard constraints (don't break these)

- **No framework, no build step, no bundler.** Vanilla HTML/CSS/JS, ES modules, served as-is by GitHub Pages. The spec prioritizes light, fast loading — keep it that way. Don't add npm dependencies for the site.
- **All paths are relative** (`./js/...`, `./data/...`). The site runs from a project subpath (`user.github.io/repo/`); absolute paths would break it.
- **The cron uses only the built-in `GITHUB_TOKEN`** (`permissions: models: read` + `contents: write`). No external secrets.

## Architecture

```
Actions cron (2×/day) → scripts/generate-message.mjs
   → GitHub Models API (fallback: data/fallback-bank.json)
   → commits data/messages.json
GitHub Pages → index.html → js/main.js
   → fetch messages.json → theme + doodle + render mode
```

`data/messages.json` is the **contract** between the pipeline and the frontend. Its shape:
```json
{ "updated": "ISO", "entries": [
  { "id": "YYYY-MM-DD-am|pm", "date": "YYYY-MM-DD", "slot": "am|pm",
    "publishAt": "ISO", "text": "...", "source": "llm|fallback|seed" } ] }
```
The client (`js/messages.js`) shows the entry with the greatest `publishAt` that is `≤ now`.

`publishAt` is **derived deterministically from `date` + `slot`** (`publishAtFor()` in the generator: AM = `00:00` UTC, PM = `11:00` UTC), **not** stamped from wall-clock `now`. This keeps AM strictly before PM and ~11h apart, so generating both slots back-to-back (local runs, seeds) can't produce near-equal timestamps that make the client pick the wrong note. Don't revert this to `now`.

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

## Module map

| File | Responsibility | Key export |
|------|----------------|-----------|
| `js/main.js` | Entry: load note, theme, render, mode toggle, SW | — |
| `js/messages.js` | Fetch + select current note | `getCurrentEntry()` |
| `js/selectEntry.js` | Pure current-note selection (shared by page + SW) | `pickCurrentEntry(entries, nowMs)` |
| `js/palette.js` | Curated palettes; one per note | `paletteFor(seed)`, `applyPalette()` |
| `js/doodles.js` | Manifest load, pick + place doodle | `renderMessageDoodle()` |
| `js/messageDecorate.js` | Message mode render | `renderMessage()`, `clearMessage()` |
| `js/doodleDecorate.js` | Bounded doodle canvas (pencil/eraser/undo/clear/save) + per-day persistence | `createDoodleDecorator()` |
| `js/prompts.js` | Daily date-seeded doodle prompt word | `promptFor(dateSeed)` |
| `js/util.js` | Hash + seeded RNG | `hashString()`, `seededRng()`, `pick()` |
| `js/pwa.js` | Service worker registration | `registerSW()` |
| `js/notify.js` | Bell toggle + Periodic Background Sync opt-in | `initNotifications(bell, state)` |

Keep modules single-purpose and small. `doodleDecorate.js` is lazy-imported by `main.js` only when entering doodle mode.

## Conventions

- **Deterministic-per-note visuals.** Palette and doodles are derived from the note `id` via `hashString` — same note always looks identical, AM ≠ PM, each note gets its own cohesive pencil palette. Don't introduce `Math.random()` for visuals; seed from the note id.
- **Message mode shows 1–4 doodles in a symmetric layout.** `doodleCountFor(seed, manifest)` picks the count (1–4, capped to manifest size); `doodleNamesFor()` picks that many *distinct* doodles. `renderMessageDoodle()` (in `js/doodles.js`) places them on a per-count layout from the `LAYOUTS` table — anchor points are left-right (and where possible top-bottom) symmetric and sit in the top/bottom margins so they frame the centred message instead of overlapping it; doodles shrink as the count grows so they never collide. Each doodle is its own absolutely-positioned `.doodle-slot` (centred on its anchor via `translate(-50%, -50%)`) with a small seeded rotation. To change the look, edit `LAYOUTS` (points + per-count `size`), not the call sites. The single-doodle path is gone — `doodleNameFor()` was replaced by `doodleCountFor()` + `doodleNamesFor()`.
- **Theme via CSS custom properties** (`--bg`, `--ink`, `--accent`) set on `.app` by `applyPalette()`. Add new themeable colors as variables, not hardcoded values.
- **Doodles are inline SVG line-art using `stroke="currentColor"`** so they inherit `--accent`. New doodles must follow this (viewBox `0 0 100 100`, no hardcoded colors).

## Invariants to preserve

- **Doodle mode has no daily note.** The drawing `<canvas>` is the only content layer; there is no move tool. The eraser uses `globalCompositeOperation = "destination-out"` on the canvas only. `save()` exports the canvas directly (no text baking).
- **`.toolbar[hidden]` needs an explicit `display:none` rule** — the author `.toolbar{display:flex}` otherwise overrides the `hidden` attribute. (Same trap applies to any element given a `display` and toggled via `hidden`.)
- Canvas drawing is DPR-aware (`fitCanvas`) and stores strokes in CSS pixels.
- **The drawing canvas is hidden in message mode via CSS** (`.app[data-mode="message"] .layer-canvas { display:none }`), not cleared — so a decorated canvas never shows behind the message doodle, yet the pixels survive a round-trip back to doodle mode. Don't "fix" leakage by clearing the canvas on mode switch.
- **Undo is snapshot-based**: `pushUndo()` captures canvas pixels *before* each action (stroke, erase, clear). If you add a new mutating action, call `pushUndo()` at its start.
- **Doodle drawings persist per day across reloads.** After each mutating action `persist()` writes `{ img: canvas dataURL }` to `localStorage` under `mindbob:doodle:<date>`, pruning all other `mindbob:doodle:*` keys so only the current day is kept — the drawing resets exactly when the date changes. `restore()` re-applies it once per load in `activate()` (after `fitCanvas()`), redrawing scaled to the live canvas. If you add a new mutating action, call `persist()` at its end (mirror of the `pushUndo()` rule). All storage access is `try/catch`-wrapped so a disabled/full `localStorage` degrades to in-memory.
- **Saved images are named `mindbob_<prompt>_<date>.png`** (`filename()` in `save()`), e.g. `mindbob_feather_2026-06-27.png` — `<prompt>` is the date-seeded doodle prompt word; empty parts (offline fallback's blank date) are dropped to avoid doubled `_`. Unique per day; don't revert to a static name.

## Commands

```bash
# local preview
python3 -m http.server 8765
#   http://localhost:8765/index.html           (message)
#   http://localhost:8765/index.html#doodle      (doodle mode — also used for testing)

# run unit tests (selection logic + SW parity; Node built-in runner, no deps)
node --test

# regenerate data (no token locally -> uses fallback bank)
node scripts/generate-message.mjs --slot=am|pm
node scripts/build-doodle-manifest.mjs   # after adding/removing doodles/*.svg
python3 scripts/make-icons.py            # after changing brand colors
```

## Verifying UI changes

There's a `chromium` binary available for headless screenshots. **Snap confinement blocks writing screenshots into the scratchpad/tmp — write them under `/home/<user>/` instead.** For interaction tests (drawing, clicks), drive Chrome via the DevTools Protocol (`--remote-debugging-port`) using Node's global `fetch`/`WebSocket`; `Input.dispatchMouseEvent` triggers the app's pointer-event handlers.

## Cron timing

`.github/workflows/generate-message.yml` schedules run in **UTC**; current values target Singapore time (`0 23` = 07:00 SGT AM, `0 11` = 19:00 SGT PM). The slot is resolved from `github.event.schedule` (or the `workflow_dispatch` input). Adjust the cron lines if the target timezone changes.

# CLAUDE.md

Guidance for working in the **mindbob** repo. Read `README.md` for user-facing setup; this file is the working context.

## What this is

A calming wellness micro-site: a single feel-good note refreshed each morning, plus a **nuggets** tab (a daily fun fact + recent tech/AI trend). Static site on GitHub Pages + a GitHub Actions cron (1×/day) that generates the note, the doodle prompt, and the nuggets. Installable as a PWA ("widget").

## Hard constraints (don't break these)

- **No framework, no build step, no bundler.** Vanilla HTML/CSS/JS, ES modules, served as-is by GitHub Pages. The spec prioritizes light, fast loading — keep it that way. Don't add npm dependencies for the site.
- **All paths are relative** (`./js/...`, `./data/...`). The site runs from a project subpath (`user.github.io/repo/`); absolute paths would break it.
- **The cron uses only the built-in `GITHUB_TOKEN`** (`permissions: models: read` + `contents: write`). No external secrets.

## Architecture

```
Actions cron (1×/day, each morning)
   → scripts/generate-message.mjs  → data/messages.json  (note; fallback: data/fallback-bank.json)
   → scripts/generate-prompt.mjs   → data/prompts.json   (doodle word)
   → scripts/generate-nuggets.mjs  → data/nuggets.json   (fun fact + tech trend; fallback: data/nugget-fallback-bank.json)
GitHub Pages → index.html → js/main.js
   → fetch the json files → theme + doodle + render mode
```

`data/messages.json` is the **contract** between the pipeline and the frontend. Its shape:
```json
{ "updated": "ISO", "entries": [
  { "id": "YYYY-MM-DD-am", "date": "YYYY-MM-DD", "slot": "am",
    "publishAt": "ISO", "text": "...", "source": "llm|fallback|seed" } ] }
```
The client (`js/messages.js`) shows the entry with the greatest `publishAt` that is `≤ now`.

**One note per day.** The note is generated each morning only; the entry keeps the `slot: "am"` field (publishing at `00:00` UTC) so the data shape and `publishAt`-based selection stay unchanged. (The PM slot was removed; `PUBLISH_HOUR_UTC.pm` and the `pm` fallback-bank array survive but are unused.)

`publishAt` is **derived deterministically from `date` + `slot`** (`publishAtFor()` in the generator: AM = `00:00` UTC), **not** stamped from wall-clock `now`. This keeps the timestamp stable so generating/seeding back-to-back can't produce near-equal timestamps that make the client pick the wrong entry. Don't revert this to `now`. The same rule applies to `data/prompts.json` and `data/nuggets.json` (both AM `00:00` UTC).

### Nuggets (daily fun fact + tech trend)

`data/nuggets.json` is the contract for the **nuggets** tab. One entry per day:
```json
{ "updated": "ISO", "entries": [
  { "id": "YYYY-MM-DD", "date": "YYYY-MM-DD", "publishAt": "ISO",
    "fact":  { "text": "...", "source": "api|bank|builtin" },
    "trend": { "text": "...", "source": "llm|pool|bank|builtin", "link": "optional-url" } } ] }
```
`js/nuggets.js` selects the current entry by **reusing `pickCurrentEntry`** (same logic as the note); `js/nuggetsDecorate.js` renders the two cards (lazy-imported on first entry into nuggets mode, like `doodleDecorate.js`).

`scripts/generate-nuggets.mjs` generation strategy — **dynamic via free, no-auth sources, degrading to a curated bank** so a pair always lands:
- **fun fact** → uselessfacts API; on any failure → `data/nugget-fallback-bank.json` `facts`.
- **tech trend** → fetch recent AI/ML headlines from Hacker News (Algolia, relevance search) + arXiv (cs.AI/cs.LG — `parseArxivEntries` also captures each paper's abs URL from its `<id>`, so a featured paper links to the paper), rank them by substance (`rankCandidates`: raw HN points are capped so opinion/drama posts can't dominate; HN titles with a technical signal are boosted above arXiv; net order: technical HN > arXiv research > non-technical HN — the "technical signal" `TECH_RE` deliberately excludes bare "open source"/"weights", which opinion posts trip). Feature the top one, and have GitHub Models write one **technical** nugget about **that title only** (the featured title is the sole LLM input — passing background headlines made the model drift to a *different* topic than `primary`, so the attached `link` no longer matched; it's also told not to invent statistics). The `link` is the featured candidate's URL; the raw featured title is stored on the entry as `trend.title`. Fallback order: **LLM → self-replenishing pool → static seed**.
- **trend pool** (`data/nugget-trend-pool.json`) — the next-best candidates we saw but did not feature are banked here (`updateTrendPool`: up to 4/run, capped at 24, FIFO, deduped against the pool and recent trends). It also dedupes/purges against recent **raw titles** (`opts.recentTitles`, from past `trend.title`): the LLM rewrites a title into different prose, so comparing rendered text alone let a pool headline re-serve a topic already featured — the raw-title check closes that repeat. When the LLM is unavailable, the trend is drawn from this pool (`source: "pool"`, a cleaned real headline); only if the pool is empty does it fall back to the static `nugget-fallback-bank.json` `trends` (`source: "bank"`). The fact path is unchanged.
- All network calls are wrapped; bank/pool picks are deterministic (rotate by entry count, no `Math.random`). Pure helpers (`cleanText`, `isGoodFact`/`isGoodTrend`, `pickFromBank`, `parseArxivEntries`, `scoreCandidate`, `rankCandidates`, `updateTrendPool`) are exported and unit-tested in `test/generate-nuggets.test.mjs`. The script only runs `main()` when invoked directly, so tests can import it safely.
- **Notifications are note-only** — nuggets do **not** trigger notifications, so `sw.js` selection/parity logic stays untouched.

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
- **Notification copy** mirrors the in-app status line: title `mindbob · today's
  note`, body = note text, tag `mindbob-note`. (Single note/day — there is no
  morning/evening split.)
- Limitation: the browser decides *when* periodic sync fires — notifications
  arrive within its background window of publish time, not at the exact minute.

## Module map

| File | Responsibility | Key export |
|------|----------------|-----------|
| `js/main.js` | Entry: load note, theme, render, mode toggle, SW | — |
| `js/messages.js` | Fetch + select current note | `getCurrentEntry()` |
| `js/selectEntry.js` | Pure current-note selection (shared by page + SW) | `pickCurrentEntry(entries, nowMs)` |
| `js/palette.js` | Curated palettes; one per note, plus a daily one for doodle mode | `paletteFor(seed)`, `doodlePaletteFor(dateSeed)`, `applyPalette()` |
| `js/doodles.js` | Manifest load, pick + place doodle | `renderMessageDoodle()` |
| `js/messageDecorate.js` | Message mode render | `renderMessage()`, `clearMessage()` |
| `js/doodleDecorate.js` | Bounded doodle canvas (pencil/eraser/undo/clear/save) + per-day persistence | `createDoodleDecorator()` |
| `js/nuggets.js` | Fetch + select current nuggets (reuses `pickCurrentEntry`) | `getCurrentNuggets()` |
| `js/nuggetsDecorate.js` | Nuggets mode render (two cards) | `renderNuggets()`, `clearNuggets()` |
| `js/prompts.js` | Daily date-seeded doodle prompt word | `promptFor(dateSeed)` |
| `js/util.js` | Hash + seeded RNG | `hashString()`, `seededRng()`, `pick()` |
| `js/pwa.js` | Service worker registration | `registerSW()` |
| `js/notify.js` | Bell toggle + Periodic Background Sync opt-in | `initNotifications(bell, state)` |

Keep modules single-purpose and small. `doodleDecorate.js` and `nuggetsDecorate.js` are lazy-imported by `main.js` only when entering their mode. `setMode()` handles three modes (`message` / `doodle` / `nuggets`); the active tab is set via `setActiveTab()` and each non-current mode is cleaned up on switch.

## Conventions

- **Deterministic visuals (no `Math.random()`).** Message-mode palette + doodles are derived from the note `id` via `hashString` — same note always looks identical, each note gets its own cohesive palette. **Doodle mode has its own palette, `doodlePaletteFor(date)`** (seeded from the date, distinct namespace): it changes each day and is decoupled from the note's palette, yet stays deterministic within a day so a persisted drawing keeps its colours across reloads. `main.js` re-applies the right palette on every mode switch (doodle → `state.doodlePalette`, message/nuggets → `state.palette`). Seed from the id/date, never `Math.random()`.
- **Message mode shows 1–4 doodles in a symmetric layout.** `doodleCountFor(seed, manifest)` picks the count (1–4, capped to manifest size); `doodleNamesFor()` picks that many *distinct* doodles. `renderMessageDoodle()` (in `js/doodles.js`) places them on a per-count layout from the `LAYOUTS` table — anchor points are left-right (and where possible top-bottom) symmetric and sit in the top/bottom margins so they frame the centred message instead of overlapping it; doodles shrink as the count grows so they never collide. Each doodle is its own absolutely-positioned `.doodle-slot` (centred on its anchor via `translate(-50%, -50%)`) with a small seeded rotation. To change the look, edit `LAYOUTS` (points + per-count `size`), not the call sites. The single-doodle path is gone — `doodleNameFor()` was replaced by `doodleCountFor()` + `doodleNamesFor()`.
- **Theme via CSS custom properties** (`--bg`, `--ink`, `--accent`) set on `.app` by `applyPalette()`. Add new themeable colors as variables, not hardcoded values.
- **Doodles are inline SVG line-art using `stroke="currentColor"`** so they inherit `--accent`. New doodles must follow this (viewBox `0 0 100 100`, no hardcoded colors).

## Invariants to preserve

- **Doodle mode has no daily note.** The drawing `<canvas>` is the only content layer; there is no move tool. The eraser uses `globalCompositeOperation = "destination-out"` on the canvas only. `save()` exports the canvas directly (no text baking).
- **`.toolbar[hidden]` needs an explicit `display:none` rule** — the author `.toolbar{display:flex}` otherwise overrides the `hidden` attribute. (Same trap applies to any element given a `display` and toggled via `hidden`.) The nuggets/message/canvas layers are instead shown/hidden purely via `.app[data-mode="…"]` selectors (no `hidden` attribute), so this trap doesn't apply there.
- Canvas drawing is DPR-aware (`fitCanvas`) and stores strokes in CSS pixels.
- **The drawing canvas is hidden in message mode via CSS** (`.app[data-mode="message"] .layer-canvas { display:none }`), not cleared — so a decorated canvas never shows behind the message doodle, yet the pixels survive a round-trip back to doodle mode. Don't "fix" leakage by clearing the canvas on mode switch.
- **Undo is snapshot-based**: `pushUndo()` captures canvas pixels *before* each action (stroke, erase, clear). If you add a new mutating action, call `pushUndo()` at its start.
- **Doodle drawings persist per day across reloads.** After each mutating action `persist()` writes `{ img: canvas dataURL }` to `localStorage` under `mindbob:doodle:<date>`, pruning all other `mindbob:doodle:*` keys so only the current day is kept — the drawing resets exactly when the date changes. `restore()` re-applies it once per load in `activate()` (after `fitCanvas()`), redrawing scaled to the live canvas. If you add a new mutating action, call `persist()` at its end (mirror of the `pushUndo()` rule). All storage access is `try/catch`-wrapped so a disabled/full `localStorage` degrades to in-memory.
- **Saved images are named `mindbob_<prompt>_<date>.png`** (`filename()` in `save()`), e.g. `mindbob_feather_2026-06-27.png` — `<prompt>` is the date-seeded doodle prompt word; empty parts (offline fallback's blank date) are dropped to avoid doubled `_`. Unique per day; don't revert to a static name.

## Commands

```bash
# local preview
python3 -m http.server 8765
#   http://localhost:8765/index.html            (message)
#   http://localhost:8765/index.html#doodle       (doodle mode — also used for testing)
#   http://localhost:8765/index.html#nuggets      (nuggets mode)

# run unit tests (selection logic + SW parity + shell-asset coverage + nugget
# helpers; Node built-in runner, no deps)
node --test

# regenerate data (no token locally -> uses fallback banks)
node scripts/generate-message.mjs
node scripts/generate-prompt.mjs
node scripts/generate-nuggets.mjs
node scripts/build-doodle-manifest.mjs   # after adding/removing doodles/*.svg
python3 scripts/make-icons.py            # after changing brand colors
```

## Verifying UI changes

There's a `chromium` binary available for headless screenshots. **Snap confinement blocks writing screenshots into the scratchpad/tmp — write them under `/home/<user>/` instead.** For interaction tests (drawing, clicks), drive Chrome via the DevTools Protocol (`--remote-debugging-port`) using Node's global `fetch`/`WebSocket`; `Input.dispatchMouseEvent` triggers the app's pointer-event handlers.

## Cron timing

`.github/workflows/generate-message.yml` runs **once a day** in **UTC**; the current value targets Singapore time (`0 22` = 06:00 SGT). The single morning run generates the note, the doodle prompt, and the nuggets, then commits `data/messages.json`, `data/prompts.json`, `data/nuggets.json`, `data/nugget-trend-pool.json`, and `doodles/index.json`. Adjust the cron line if the target timezone changes.

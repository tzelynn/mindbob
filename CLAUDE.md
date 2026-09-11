# CLAUDE.md

Guidance for working in the **mindbob** repo. Read `README.md` for user-facing setup; this file is the working context.

## What this is

A calming wellness micro-site with four modes behind a single-icon menu (plus swipe navigation): **nuggets** (a daily fun fact + recent tech/AI trend — the landing mode), a **brain**-dump list, a **mood** tracker, and a daily **doodle** canvas (with a gallery of past drawings). Static site on GitHub Pages + a GitHub Actions cron (2×/day: main run + upgrade-only retry) that generates the nuggets and the doodle prompt. Installable as a PWA ("widget"), with a ⟳ button to pull the latest deploy into an installed copy.

The daily motivational **note** (message mode) was removed: `js/messages.js`, `js/messageDecorate.js`, `js/doodles.js`, `doodles/*.svg`, `data/messages.json`, `data/fallback-bank.json`, `scripts/generate-message.mjs` and `scripts/build-doodle-manifest.mjs` are gone. Don't reintroduce them.

## Hard constraints (don't break these)

- **No framework, no build step, no bundler.** Vanilla HTML/CSS/JS, ES modules, served as-is by GitHub Pages. The spec prioritizes light, fast loading — keep it that way. Don't add npm dependencies for the site.
- **All paths are relative** (`./js/...`, `./data/...`). The site runs from a project subpath (`user.github.io/repo/`); absolute paths would break it.
- **The cron uses only the built-in `GITHUB_TOKEN`** (`permissions: models: read` + `contents: write`). No external secrets.

## Architecture

```
Actions cron (2×/day: main run each morning + an upgrade-only retry ~1.5h later)
   → scripts/generate-nuggets.mjs  → data/nuggets.json   (fun fact + tech trend; fallback: data/nugget-fallback-bank.json)
   → scripts/generate-prompt.mjs   → data/prompts.json   (doodle word)
GitHub Pages → index.html → js/main.js
   → fetch the json files → theme + render mode
```

Both generators share `scripts/lib.mjs` (`fetchWithRetry` with per-attempt
timeouts + backoff, and the `planWork` upgrade-only decision) and are
**upgrade-only**: a run skips regeneration when today's entry already came from
its best source (prompt `llm`; nuggets per part — fact `api`, trend `llm`),
retries lower tiers, and on a failed retry keeps the existing entry
**byte-for-byte** (no write, no `updated` bump, no commit). A retry can never
downgrade a good entry. `FORCE_REGENERATE=1` (the workflow's `force` dispatch
input) restores unconditional regeneration.

`publishAt` is **derived deterministically from `date`** (`publishAtFor()` in each generator: `00:00` UTC), **not** stamped from wall-clock `now`. This keeps the timestamp stable so generating/seeding back-to-back can't produce near-equal timestamps that make the client pick the wrong entry. Don't revert this to `now`. It applies to both `data/prompts.json` and `data/nuggets.json`.

### Nuggets (daily fun fact + tech trend)

`data/nuggets.json` is the contract for the **nuggets** mode. One entry per day:
```json
{ "updated": "ISO", "entries": [
  { "id": "YYYY-MM-DD", "date": "YYYY-MM-DD", "publishAt": "ISO",
    "fact":  { "text": "...", "source": "api|bank|builtin" },
    "trend": { "text": "...", "source": "llm|pool|bank|builtin", "link": "optional-url" } } ] }
```
Nuggets are the app's landing content. `js/nuggets.js` selects the current entry via `pickCurrentEntry` (`js/selectEntry.js`) — the entry with the greatest `publishAt` that is `≤ now`. **The data is fetched eagerly in `init()`**, not on first entry into nuggets mode, because the fun fact is also the notification payload and `js/notify.js` seeds the last-notified id from `state.nuggets.id`. Only the render module `js/nuggetsDecorate.js` is lazy-imported (like `doodleDecorate.js`).

`scripts/generate-nuggets.mjs` generation strategy — **dynamic via free, no-auth sources, degrading to a curated bank** so a pair always lands:
- **fun fact** → uselessfacts API; on any failure → `data/nugget-fallback-bank.json` `facts`.
- **tech trend** → fetch recent AI/ML headlines from Hacker News (Algolia, relevance search) + arXiv (cs.AI/cs.LG — `parseArxivEntries` also captures each paper's abs URL from its `<id>`, so a featured paper links to the paper), rank them by substance (`rankCandidates`: raw HN points are capped so opinion/drama posts can't dominate; HN titles with a technical signal are boosted above arXiv; net order: technical HN > arXiv research > non-technical HN — the "technical signal" `TECH_RE` deliberately excludes bare "open source"/"weights", which opinion posts trip). Feature the top one, and have GitHub Models write one **technical** nugget about **that title only** (the featured title is the sole LLM input — passing background headlines made the model drift to a *different* topic than `primary`, so the attached `link` no longer matched; it's also told not to invent statistics). The `link` is the featured candidate's URL; the raw featured title is stored on the entry as `trend.title`. Fallback order: **LLM → self-replenishing pool → static seed**.
- **trend pool** (`data/nugget-trend-pool.json`) — the next-best candidates we saw but did not feature are banked here (`updateTrendPool`: up to 4/run, capped at 24, FIFO, deduped against the pool and recent trends). It also dedupes/purges against recent **raw titles** (`opts.recentTitles`, from past `trend.title`): the LLM rewrites a title into different prose, so comparing rendered text alone let a pool headline re-serve a topic already featured — the raw-title check closes that repeat. When the LLM is unavailable, the trend is drawn from this pool (`source: "pool"`, a cleaned real headline); only if the pool is empty does it fall back to the static `nugget-fallback-bank.json` `trends` (`source: "bank"`). The fact path is unchanged.
- All network calls are wrapped; bank/pool picks are deterministic (rotate by entry count, no `Math.random`). Pure helpers (`cleanText`, `isGoodFact`/`isGoodTrend`, `pickFromBank`, `parseArxivEntries`, `scoreCandidate`, `rankCandidates`, `updateTrendPool`) are exported and unit-tested in `test/generate-nuggets.test.mjs`. The script only runs `main()` when invoked directly, so tests can import it safely.
- **The fun fact is the notification payload** — see Notifications below.

### Notifications (opt-in, no backend)

A 🔔 toggle (`js/notify.js`) lets users opt into local notifications for the
day's new **fun fact**. There is **no push server**: the service worker registers
a Periodic Background Sync task (`mindbob-check`, min interval 12h); when the
browser wakes it, `checkForNewFact()` re-fetches `nuggets.json`, selects the
current entry via `pickCurrentEntry`, and shows a notification with
`entry.fact.text` as the body if the entry `id` differs from the last one stored.
Selection logic lives once in `js/selectEntry.js`; `sw.js` keeps a byte-identical
copy (classic workers can't import ES modules) guarded by the
`test/sw-selection.test.mjs` parity test. `test/sw-notify.test.mjs` evaluates
`sw.js` in a stubbed worker global and pins the payload (fact, not trend), the
dedupe, and the silent paths (no fact text, failed fetch).

Invariants:
- **The bell is hidden where Periodic Background Sync is unsupported** (iOS
  Safari, desktop Firefox/Safari, uninstalled PWA) — it always means real
  background push. Don't add a foreground fallback.
- **Cross-context state** (the last-notified nuggets-entry id) lives in the **unversioned
  `mindbob-meta` cache** under key `https://mindbob.local/last-notified`, written
  by both `js/notify.js` (seed on enable) and `sw.js` (on notify). It is
  **excluded from the `activate()` cache cleanup**, and from the page-side purge
  in `js/update.js` — adding a versioned cache to either keep-list must not drop
  `META_CACHE`, or the next check re-notifies for a fact already seen.
- **Notification copy**: title `mindbob · today's fun fact`, body =
  `entry.fact.text`, tag `mindbob-fact`, and the click target deep-links to
  `#nuggets`. One entry/day, so one notification/day.
- **A run with no fact text must not burn the dedupe id** — `checkForNewFact()`
  bails *before* `setLastNotifiedId`, so a later run can still notify once the
  fact lands.
- Limitation: the browser decides *when* periodic sync fires — notifications
  arrive within its background window of publish time, not at the exact minute.

### Updating an installed PWA (the ⟳ button)

An installed PWA is served from the versioned shell cache, so it can lag a Pages
deploy indefinitely. `js/update.js` wires the topbar ⟳ button:

1. `registration.update()` re-fetches `sw.js` (browsers bypass the HTTP cache for
   the SW script). `sw.js` already calls `skipWaiting()` in `install`, so a bumped
   `VERSION` installs a fresh shell cache and activates on its own — we wait for
   the new worker to leave `installing`/`waiting`, then reload.
2. If `sw.js` is byte-identical there is **no** new worker, yet other assets may
   still have changed. Then the page purges the versioned caches itself
   (`CacheStorage` is same-origin — no `postMessage` plumbing) so the reload
   refetches from the network.

Invariants:
- **Bump `VERSION` in `sw.js` whenever a shell asset changes.** Path 1 is the
  cheap path; path 2 exists only so a forgotten bump isn't a dead end.
- **`mindbob-meta` is never purged** (see Notifications) — it is the one cache
  excluded in both `sw.js`'s `activate()` and `js/update.js`'s `purgeCaches()`.
- **`SHELL_ASSETS` must list every module** — `test/shell-assets.test.mjs` walks
  the import graph of `js/*.js` and fails when one is missing.
- **`#status` is the update button's toast, not a status line.** It is
  `display:none` by default; `js/update.js` adds `.is-toast` to reveal it, and
  `.app .status.is-toast` out-specifies the per-mode rules. (The old always-on
  "today's note" status line went with message mode.)
- The reload always fires, even on error — a failed check must not leave the user
  on a stale build with a spinning button.

## Module map

| File | Responsibility | Key export |
|------|----------------|-----------|
| `js/main.js` | Entry: load nuggets, theme, render, mode menu + swipe + history/back nav, SW | — |
| `js/modes.js` | Pure mode order + swipe classification (shared source of truth) | `MODES`, `nextMode(mode, dir)`, `resolveSwipe(dx, dy)` |
| `js/selectEntry.js` | Pure current-entry selection (shared by page + SW) | `pickCurrentEntry(entries, nowMs)` |
| `js/palette.js` | Curated palettes; one per day, plus a separate one for doodle mode | `paletteFor(seed)`, `doodlePaletteFor(dateSeed)`, `applyPalette()` |
| `js/doodleDecorate.js` | Bounded doodle canvas (pencil/eraser/undo/clear/save) + per-day persistence + gallery archiving | `createDoodleDecorator()` |
| `js/galleryStore.js` | IndexedDB store for past doodles (WebP/JPEG/PNG blobs) | `putEntry()`, `getAllEntries()`, `deleteEntry()`, `galleryFilename()` |
| `js/galleryView.js` | Gallery overlay UI (grid → viewer with download/delete) | `createGalleryView(refs, state)` |
| `js/nuggets.js` | Fetch + select current nuggets (reuses `pickCurrentEntry`) | `getCurrentNuggets()` |
| `js/nuggetsDecorate.js` | Nuggets mode render (two cards) | `renderNuggets()`, `clearNuggets()` |
| `js/mood.js` | DOM-free mood storage + calendar helpers | `readMood()`, `writeMood()`, `readAllMoods()` |
| `js/moodDecorate.js` | Mood mode render (log strip + week/month/year grids) | `renderMood()`, `clearMood()` |
| `js/brain.js` | DOM-free brain-dump task storage (add/rename/remove/toggle) | — |
| `js/brainDecorate.js` | Brain mode render (monthly + to-do lists, click-to-edit items) | `renderBrain()`, `clearBrain()` |
| `js/prompts.js` | Daily date-seeded doodle prompt word | `promptFor(dateSeed)` |
| `js/util.js` | Hash + seeded RNG + today's UTC date | `hashString()`, `seededRng()`, `pick()`, `todayDate()` |
| `js/pwa.js` | Service worker registration | `registerSW()` |
| `js/notify.js` | Bell toggle + Periodic Background Sync opt-in | `initNotifications(bell, state)` |
| `js/update.js` | ⟳ button: pull the newest deploy into an installed PWA | `initUpdate(btn, status)` |

Keep modules single-purpose and small. The decorate modules (and `galleryView.js`) are lazy-imported by `main.js`/`doodleDecorate.js` only when first needed. `setMode()` handles the four modes in `MODES` (`nuggets` / `brain` / `mood` / `doodle`) — `MODES[0]` is the landing mode and the fallback for an unknown hash, so reordering the list moves the landing screen; the active item is set via `setActiveTab()` and each non-current mode is cleaned up on switch. **Navigation**: the topbar has a single-icon mode menu (hamburger trigger + dropdown, items built from `MODES`), and horizontal swipes on `.stage` move between adjacent modes (**cyclical** — `nextMode` wraps past either end, so swiping keeps carousel-ing through the modes; a `pointerdown` on the drawing canvas, or inside an `input`/`textarea`, never starts a swipe — the canvas owns its gestures, and a drag-select inside a text field must not swipe the mode away mid-edit). `.stage` has `touch-action: pan-y` so vertical scrolling stays native while horizontal pans reach the swipe handler; don't remove it.

Both the menu and swipes route through `navigate(mode)`, which **pushes a history entry** before rendering, so the device/browser back button steps back through modes instead of exiting the app (issue: an uninstalled/installed PWA otherwise has a single history entry). The initial mode is seeded with `replaceState`; a `popstate` listener re-renders the popped mode **without** pushing again; and a back press while the gallery overlay is open just dismisses the overlay (it has no history entry of its own) and re-asserts the current mode. `setMode()` also dismisses an open gallery on any switch, and `.topbar` sits at `z-index: 30` — **above** the gallery overlay's `z-index: 20` — so the mode dropdown stays clickable while the gallery is open (`.stage` is not a stacking context, so the overlay would otherwise paint over the topbar's dropdown).

**Scrollable mode layers must not eat horizontal swipes.** `.layer-nuggets` / `.layer-mood` / `.layer-brain` scroll vertically (`overflow-y: auto`), which makes CSS compute `overflow-x` to `auto` too; combined with their cards being wider than the padded viewport this let a horizontal drag scroll the layer sideways instead of reaching the `.stage` swipe handler. Each such layer therefore also sets `overflow-x: hidden` + `touch-action: pan-y`, and their cards are sized `width: 100%; max-width: 460px` (fit the padded layer) rather than in `vw`. Keep this pattern for any new scrollable layer.

## Conventions

- **Deterministic visuals (no `Math.random()`).** Everything is seeded from `state.date` — `todayDate()` in `js/util.js`, the **UTC** `YYYY-MM-DD` (the same clock the generators stamp entries with, so a client-side fallback can't disagree with the data). The app palette is `paletteFor(date)`; **doodle mode has its own palette, `doodlePaletteFor(date)`** (same seed, distinct hash namespace) so it's decoupled from the rest of the app, yet stays deterministic within a day so a persisted drawing keeps its colours across reloads. `main.js` re-applies the right palette on every mode switch (doodle → `state.doodlePalette`, every other mode → `state.palette`). Seed from the date, never `Math.random()`. `state.date` is **not** read off the fetched entry — a stale `nuggets.json` (cron failure) must not freeze the doodle storage key on yesterday.
- **Theme via CSS custom properties** (`--bg`, `--ink`, `--accent`) set on `.app` by `applyPalette()`. Add new themeable colors as variables, not hardcoded values.
- **Doodles are inline SVG line-art using `stroke="currentColor"`** so they inherit `--accent`. New doodles must follow this (viewBox `0 0 100 100`, no hardcoded colors).

## Invariants to preserve

- **Doodle mode's drawing `<canvas>` is its only content layer**; there is no move tool. The eraser uses `globalCompositeOperation = "destination-out"` on the canvas only. `save()` composites a **header band** (rounded accent box with the prompt word + date) *above* the drawing — the output canvas grows by the band height, never overlapping the strokes; all band math is in CSS px under the `dpr` transform.
- **`.toolbar[hidden]` needs an explicit `display:none` rule** — the author `.toolbar{display:flex}` otherwise overrides the `hidden` attribute. (Same trap applies to any element given a `display` and toggled via `hidden`.) The `.icon-btn` topbar buttons (🔔 bell, ⟳ update) carry the same explicit `[hidden]` rule for that reason. The nuggets/canvas layers are instead shown/hidden purely via `.app[data-mode="…"]` selectors (no `hidden` attribute), so this trap doesn't apply there.
- Canvas drawing is DPR-aware (`fitCanvas`) and stores strokes in CSS pixels.
- **The drawing canvas is hidden outside doodle mode via CSS** (`.app[data-mode="nuggets"|"mood"|"brain"] .layer-canvas { display:none }`), not cleared — so the pixels survive a round-trip back to doodle mode. Don't "fix" leakage by clearing the canvas on mode switch.
- **`registerSW()` must not wait on `window.load`.** It is called from the tail of `main.js`'s async `init()`, after several awaited fetches — by then `load` has already fired, so a listener added there never runs. `js/pwa.js` registers immediately when `document.readyState === "complete"` (regression-tested in `test/pwa.test.mjs`). Without this the service worker never registers at all: no offline shell **and** no notification bell (`initNotifications` awaits `navigator.serviceWorker.ready`, which never resolves).
- **Undo is snapshot-based**: `pushUndo()` captures canvas pixels *before* each action (stroke, erase, clear). If you add a new mutating action, call `pushUndo()` at its start.
- **Doodle drawings persist per day across reloads.** After each mutating action `persist()` writes `{ img: canvas dataURL, word, palette }` to `localStorage` under `mindbob:doodle:<date>`, pruning all other `mindbob:doodle:*` keys so only the current day is kept there — but **past days are archived into the gallery first**: `archiveStale()` runs at the top of `activate()` (before `restore()` and before any prune can fire), synchronously capturing stale payloads, then downscaling to ≤640px, skipping blank canvases, baking a **neutral white** background behind the strokes (lossy formats have no alpha; the day's `bg` tint is deliberately *not* used, so every gallery thumbnail reads on a common ground), and storing a compressed blob in IndexedDB (`mindbob-gallery`, via `js/galleryStore.js`, FIFO-capped at 730 entries). The localStorage key is removed only after `putEntry` succeeds; if IndexedDB is unavailable the behavior degrades to the old prune. `restore()` re-applies today's drawing once per load in `activate()` (after `fitCanvas()`), redrawing scaled to the live canvas. If you add a new mutating action, call `persist()` at its end (mirror of the `pushUndo()` rule). All storage access is `try/catch`-wrapped so disabled/full storage degrades gracefully.
- **WebP encoding must be feature-checked**: `canvas.toBlob(cb, "image/webp")` silently substitutes PNG on Safari/Firefox — check `blob.type` (see `encodeThumb()`: WebP → JPEG → PNG) and derive file extensions from the stored `type`, never assume.
- **Gallery labels fall back to the prompt, never "doodle".** `labelFor(entry)` (in `js/galleryView.js`, exported + unit-tested) resolves a thumbnail's title to `entry.word || promptFor(entry.date)` — the day's deterministic date-seeded prompt — so legacy/blank entries still read as a real word. `archiveOne()` backfills the same way when banking, so new entries are never stored word-less. The card word, viewer meta, and download filename all go through `labelFor`.
- **Saved images are named `mindbob_<prompt>_<date>.png`** (`filename()` in `save()`), e.g. `mindbob_feather_2026-06-27.png` — `<prompt>` is the date-seeded doodle prompt word; empty parts (offline fallback's blank date) are dropped to avoid doubled `_`. Unique per day; don't revert to a static name. Gallery downloads use the same shape via `galleryFilename()` with the extension derived from the blob type.

## Commands

```bash
# local preview — any mode name from MODES works as a hash
python3 -m http.server 8765
#   http://localhost:8765/index.html            (nuggets — the default landing mode)
#   http://localhost:8765/index.html#brain        (brain dump)
#   http://localhost:8765/index.html#mood         (mood tracker)
#   http://localhost:8765/index.html#doodle       (doodle mode — also used for testing)

# run unit tests (selection logic + SW parity + SW notification payload +
# shell-asset coverage + nugget helpers + mode/swipe helpers + gallery helpers +
# retry/upgrade-only helpers + mood/brain storage; Node built-in runner, no deps)
node --test

# regenerate data (no token locally -> uses fallback banks). Re-running on the
# same day is upgrade-only: a no-op if today's entry is already best-tier, and
# a failed retry keeps the existing entry byte-identical. Force with:
#   FORCE_REGENERATE=1 node scripts/generate-nuggets.mjs
node scripts/generate-nuggets.mjs
node scripts/generate-prompt.mjs
python3 scripts/make-icons.py            # after changing brand colors
```

## Verifying UI changes

There's a `chromium` binary available for headless screenshots. **Snap confinement blocks writing screenshots into the scratchpad/tmp — write them under `/home/<user>/` instead.** For interaction tests (drawing, clicks, swipes), drive Chrome via the DevTools Protocol (`--remote-debugging-port`) using Node's global `fetch`/`WebSocket`; `Input.dispatchMouseEvent` triggers the app's pointer-event handlers. The full launch/drive recipe (including the gotchas: hash-mode tests need a fresh tab, measure click targets after images decode) lives in `.claude/skills/verify/SKILL.md`.

## Cron timing

`.github/workflows/generate-daily.yml` runs **twice a day** in **UTC**, targeting Singapore mornings: the main cron (`20 20` → commits ~04:20–05:35 SGT) generates the nuggets and the doodle prompt, then commits `data/nuggets.json`, `data/nugget-trend-pool.json`, and `data/prompts.json`; the retry cron (`50 21` → ~06:20–07:05 SGT) re-runs the same job, which — because the scripts are upgrade-only — regenerates **only** entries that fell back (or everything, if the first run hard-failed) and is a commit-free no-op otherwise. The generate steps carry `if: ${{ !cancelled() }}` so one script's crash doesn't discard the others' output. `workflow_dispatch` is safe to trigger anytime; its `force` input maps to `FORCE_REGENERATE=1`. Adjust both cron lines together if the target timezone changes.

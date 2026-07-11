# mindbob

A calming wellness micro-site that shows a feel-good note, refreshed **each morning**.
Hosted on GitHub Pages, installable to a phone home screen as a PWA, and built to
load instantly.

https://tzelynn.github.io/mindbob/

Five modes live behind a single menu in the top bar; on a phone you can also
swipe left/right to move between them.

- **Message mode** — the note is arranged with a little hand-drawn doodle in a calm layout.
- **Doodle mode** — draw the daily prompt word with a per-day colour palette, erase, undo,
  and save your drawing (the saved image carries the prompt + date in a little header box).
  Past days' drawings collect automatically in a **gallery** (stored in your browser's
  IndexedDB as small compressed images — view, download, or delete them anytime).
- **Nuggets mode** — two daily nuggets: a fun fact and a recent tech/AI trend.
- **Mood mode** — log the day's mood and browse a week/month/year history.
- **Brain mode** — a monthly checklist plus an ad-hoc to-do list.

## How it works

```
GitHub Actions (cron, 2×/day: main run each morning + an upgrade-only retry)
  ├─ scripts/generate-message.mjs
  │    ├─ GitHub Models API (free, uses the built-in GITHUB_TOKEN)
  │    ├─ validate tone/length/dedupe ── on failure ─▶ data/fallback-bank.json
  │    └─ commit data/messages.json
  ├─ scripts/generate-prompt.mjs   → data/prompts.json   (daily doodle word)
  └─ scripts/generate-nuggets.mjs  → data/nuggets.json   (fun fact + tech trend)
       ├─ fun fact: free facts API ── on failure ─▶ data/nugget-fallback-bank.json
       └─ tech trend: Hacker News + arXiv headlines → GitHub Models rewrite
                            │
GitHub Pages (static)  ◀────┘
  └─ index.html → fetch json → theme + doodle + render
```

All network calls retry transient failures with backoff and timeouts
(`scripts/lib.mjs`), and the scripts are **upgrade-only**: the second cron
re-attempts only entries that fell back to a bank, never overwrites a good
LLM-generated entry, and commits nothing when there's nothing to improve.

No build step, no framework, no secrets to configure. Vanilla HTML/CSS/JS (ES modules).

## Project layout

| Path | Purpose |
|------|---------|
| `index.html`, `styles.css` | App shell + calming theme (palette via CSS variables) |
| `js/main.js` | Entry: load note, theme, mode menu + swipe navigation, register SW |
| `js/modes.js` | Mode order + swipe classification (shared by menu, swipe, hash) |
| `js/messages.js` | Fetch `messages.json`, pick the current note |
| `js/palette.js` | Curated calming palettes; one per note (deterministic) |
| `js/doodles.js` | Load manifest, pick + place a doodle (deterministic) |
| `js/messageDecorate.js` / `js/doodleDecorate.js` | Message note render / doodle canvas |
| `js/galleryStore.js` / `js/galleryView.js` | Past-doodles gallery (IndexedDB store + overlay UI) |
| `js/prompts.js` | Daily date-seeded doodle prompt word (deterministic) |
| `js/nuggets.js` / `js/nuggetsDecorate.js` | Fetch + render the daily nuggets tab |
| `js/mood.js` / `js/moodDecorate.js` | Mood tracker (storage + render) |
| `js/brain.js` / `js/brainDecorate.js` | Brain dump (storage + render) |
| `data/messages.json` | Generated notes (the live data) |
| `data/prompts.json` | Generated daily doodle words |
| `data/nuggets.json` | Generated daily nuggets (fun fact + tech trend) |
| `data/fallback-bank.json` | Hand-written notes used when the LLM is unavailable |
| `data/nugget-fallback-bank.json` | Hand-written nuggets used when sources are unavailable |
| `data/nugget-trend-pool.json` | Self-replenishing pool of recent real headlines (trend fallback) |
| `doodles/*.svg` + `index.json` | Doodle library + its manifest |
| `scripts/lib.mjs` | Shared fetch-retry/timeout + upgrade-only helpers for the cron workers |
| `scripts/generate-message.mjs` | Cron worker (daily note) |
| `scripts/generate-prompt.mjs` | Cron worker (daily doodle word) |
| `scripts/generate-nuggets.mjs` | Cron worker (daily fun fact + tech trend) |
| `scripts/build-doodle-manifest.mjs` | Regenerates `doodles/index.json` |
| `scripts/make-icons.py` | Regenerates PWA icons |
| `test/*.test.mjs` | Unit tests (Node built-in runner, no deps) |
| `.github/workflows/generate-message.yml` | The daily schedule (main + retry crons) |

## The daily cron

`.github/workflows/generate-message.yml` runs twice a day (times chosen early and
off-the-hour because GitHub's scheduler queues runs 30–75 min late):

- `20 20 * * *` UTC → commits **~04:20–05:35 SGT** → morning note + doodle prompt + nuggets
- `50 21 * * *` UTC → commits **~06:20–07:05 SGT** → retry: re-attempts only entries that
  fell back to a bank on the first run (or everything, if the first run failed outright);
  a no-op with no commit when the morning run fully succeeded

Edit both cron lines to match your timezone. To test now: **Actions → Generate message →
Run workflow** (safe to run anytime — it won't overwrite good entries; tick the **force**
input to regenerate regardless). It uses GitHub Models via the built-in `GITHUB_TOKEN`
(free tier easily covers a few calls/day), retries transient failures with backoff, and
falls back to the hand-written banks when the LLM stays unavailable. Nugget sources
(Hacker News, arXiv, a free facts API) need no auth.

## Adding doodles

Drop a new `.svg` into `doodles/` (line-art using `stroke="currentColor"` so it picks up the palette), then run:

```bash
node scripts/build-doodle-manifest.mjs
```

The cron also regenerates the manifest on every run, so simply committing an SVG is enough.

## Local development

```bash
python3 -m http.server 8765
# open http://localhost:8765/index.html         (message mode)
# open http://localhost:8765/index.html#doodle    (doodle mode)
# open http://localhost:8765/index.html#nuggets   (nuggets mode)
# open http://localhost:8765/index.html#mood      (mood tracker)
# open http://localhost:8765/index.html#brain     (brain dump)

# run the unit tests (Node's built-in runner, no dependencies):
node --test

# regenerate data locally (no token -> uses the fallback banks).
# Re-running on the same day is a no-op unless an entry can be upgraded;
# prefix with FORCE_REGENERATE=1 to regenerate regardless:
node scripts/generate-message.mjs
node scripts/generate-prompt.mjs
node scripts/generate-nuggets.mjs
node scripts/build-doodle-manifest.mjs
python3 scripts/make-icons.py
```

## Install as a "widget"

Open the site on your phone → browser menu → **Add to Home Screen**. It launches
fullscreen (no browser chrome) showing the current note, and works offline via the
service worker. (True live home-screen widgets require a native app and are out of scope.)

## Notifications

Tap the 🔔 bell in the top bar to get notified of new notes. Available on Chromium-based
browsers and Android with the app installed as a PWA; the timing follows the browser's
background schedule, so notifications arrive within a few hours of publish time.

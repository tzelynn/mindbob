# mindbob

A calming wellness micro-site built around two daily nuggets, refreshed **each morning**.
Hosted on GitHub Pages, installable to a phone home screen as a PWA, and built to
load instantly.

https://tzelynn.github.io/mindbob/

Four modes live behind a single menu in the top bar; on a phone you can also
swipe left/right to move between them.

- **Nuggets mode** — the landing screen: a fun fact and a recent tech/AI trend.
- **Brain mode** — a monthly checklist plus an ad-hoc to-do list.
- **Mood mode** — log the day's mood and browse a week/month/year history.
- **Doodle mode** — draw the daily prompt word with a per-day colour palette, erase, undo,
  and save your drawing (the saved image carries the prompt + date in a little header box).
  Past days' drawings collect automatically in a **gallery** (stored in your browser's
  IndexedDB as small compressed images — view, download, or delete them anytime).

## How it works

```
GitHub Actions (cron, 2×/day: main run each morning + an upgrade-only retry)
  ├─ scripts/generate-nuggets.mjs  → data/nuggets.json   (fun fact + tech trend)
  │    ├─ fun fact: free facts API ── on failure ─▶ data/nugget-fallback-bank.json
  │    └─ tech trend: Hacker News + arXiv headlines → GitHub Models rewrite
  └─ scripts/generate-prompt.mjs   → data/prompts.json   (daily doodle word)
                            │
GitHub Pages (static)  ◀────┘
  └─ index.html → fetch json → theme + render
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
| `js/main.js` | Entry: load nuggets, theme, mode menu + swipe navigation, register SW |
| `js/modes.js` | Mode order + swipe classification (shared by menu, swipe, hash) |
| `js/nuggets.js` / `js/nuggetsDecorate.js` | Fetch + render the daily nuggets (landing mode) |
| `js/selectEntry.js` | Pure "which dated entry is current" rule (shared by page + SW) |
| `js/palette.js` | Curated calming palettes; one per day (deterministic) |
| `js/doodleDecorate.js` | Doodle canvas (draw/erase/undo/save + per-day persistence) |
| `js/galleryStore.js` / `js/galleryView.js` | Past-doodles gallery (IndexedDB store + overlay UI) |
| `js/prompts.js` | Daily date-seeded doodle prompt word (deterministic) |
| `js/mood.js` / `js/moodDecorate.js` | Mood tracker (storage + render) |
| `js/brain.js` / `js/brainDecorate.js` | Brain dump (storage + render) |
| `js/notify.js` | 🔔 opt-in background notification for the daily fun fact |
| `js/update.js` | ⟳ pull the latest deploy into an installed PWA |
| `data/nuggets.json` | Generated daily nuggets (fun fact + tech trend) |
| `data/prompts.json` | Generated daily doodle words |
| `data/nugget-fallback-bank.json` | Hand-written nuggets used when sources are unavailable |
| `data/nugget-trend-pool.json` | Self-replenishing pool of recent real headlines (trend fallback) |
| `scripts/lib.mjs` | Shared fetch-retry/timeout + upgrade-only helpers for the cron workers |
| `scripts/generate-nuggets.mjs` | Cron worker (daily fun fact + tech trend) |
| `scripts/generate-prompt.mjs` | Cron worker (daily doodle word) |
| `scripts/make-icons.py` | Regenerates PWA icons |
| `test/*.test.mjs` | Unit tests (Node built-in runner, no deps) |
| `.github/workflows/generate-daily.yml` | The daily schedule (main + retry crons) |

## The daily cron

`.github/workflows/generate-daily.yml` runs twice a day (times chosen early and
off-the-hour because GitHub's scheduler queues runs 30–75 min late):

- `20 20 * * *` UTC → commits **~04:20–05:35 SGT** → morning nuggets + doodle prompt
- `50 21 * * *` UTC → commits **~06:20–07:05 SGT** → retry: re-attempts only entries that
  fell back to a bank on the first run (or everything, if the first run failed outright);
  a no-op with no commit when the morning run fully succeeded

Edit both cron lines to match your timezone. To test now: **Actions → Generate daily data →
Run workflow** (safe to run anytime — it won't overwrite good entries; tick the **force**
input to regenerate regardless). It uses GitHub Models via the built-in `GITHUB_TOKEN`
(free tier easily covers a few calls/day), retries transient failures with backoff, and
falls back to the hand-written banks when the LLM stays unavailable. Nugget sources
(Hacker News, arXiv, a free facts API) need no auth.

## Local development

```bash
python3 -m http.server 8765
# open http://localhost:8765/index.html         (nuggets — the landing mode)
# open http://localhost:8765/index.html#brain     (brain dump)
# open http://localhost:8765/index.html#mood      (mood tracker)
# open http://localhost:8765/index.html#doodle    (doodle mode)

# run the unit tests (Node's built-in runner, no dependencies):
node --test

# regenerate data locally (no token -> uses the fallback banks).
# Re-running on the same day is a no-op unless an entry can be upgraded;
# prefix with FORCE_REGENERATE=1 to regenerate regardless:
node scripts/generate-nuggets.mjs
node scripts/generate-prompt.mjs
python3 scripts/make-icons.py
```

## Install as a "widget"

Open the site on your phone → browser menu → **Add to Home Screen**. It launches
fullscreen (no browser chrome) showing today's nuggets, and works offline via the
service worker. (True live home-screen widgets require a native app and are out of scope.)

## Notifications

Tap the 🔔 bell in the top bar to get notified of the day's new **fun fact**. Available on
Chromium-based browsers and Android with the app installed as a PWA; the timing follows the
browser's background schedule, so notifications arrive within a few hours of publish time.

## Updating an installed app

An installed PWA is served from the service worker's cache, so it can lag a deploy. Tap the
**⟳** button in the top bar to pull the latest version: it re-checks `sw.js`, and if nothing
changed there it clears the cached assets anyway, then reloads. Your saved doodles, moods
and brain-dump items are untouched — they live in IndexedDB/localStorage, not the cache.

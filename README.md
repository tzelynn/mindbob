# mindbob

A calming wellness micro-site that shows a feel-good note, refreshed **each morning**.
Hosted on GitHub Pages, installable to a phone home screen as a PWA, and built to
load instantly.

https://tzelynn.github.io/mindbob/

- **Message mode** — the note is arranged with a little hand-drawn doodle in a calm layout.
- **Doodle mode** — draw with a per-message colour palette, erase, undo, and save your drawing.
- **Nuggets mode** — two daily nuggets: a fun fact and a recent tech/AI trend.

## How it works

```
GitHub Actions (cron, 1×/day each morning)
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

No build step, no framework, no secrets to configure. Vanilla HTML/CSS/JS (ES modules).

## Project layout

| Path | Purpose |
|------|---------|
| `index.html`, `styles.css` | App shell + calming theme (palette via CSS variables) |
| `js/main.js` | Entry: load note, theme, render mode, register SW |
| `js/messages.js` | Fetch `messages.json`, pick the current note |
| `js/palette.js` | Curated calming palettes; one per note (deterministic) |
| `js/doodles.js` | Load manifest, pick + place a doodle (deterministic) |
| `js/messageDecorate.js` / `js/doodleDecorate.js` | The two render modes (message note / doodle) |
| `js/prompts.js` | Daily date-seeded doodle prompt word (deterministic) |
| `js/nuggets.js` / `js/nuggetsDecorate.js` | Fetch + render the daily nuggets tab |
| `data/messages.json` | Generated notes (the live data) |
| `data/nuggets.json` | Generated daily nuggets (fun fact + tech trend) |
| `data/fallback-bank.json` | Hand-written notes used when the LLM is unavailable |
| `data/nugget-fallback-bank.json` | Hand-written nuggets used when sources are unavailable |
| `doodles/*.svg` + `index.json` | Doodle library + its manifest |
| `scripts/generate-message.mjs` | Cron worker (daily note) |
| `scripts/generate-prompt.mjs` | Cron worker (daily doodle word) |
| `scripts/generate-nuggets.mjs` | Cron worker (daily fun fact + tech trend) |
| `scripts/build-doodle-manifest.mjs` | Regenerates `doodles/index.json` |
| `scripts/make-icons.py` | Regenerates PWA icons |
| `.github/workflows/generate-message.yml` | The daily schedule |

## The daily cron

`.github/workflows/generate-message.yml` runs once a day at:

- `0 23 * * *` UTC → **07:00 SGT** → morning note + doodle prompt + nuggets

Edit that cron line to match your timezone. To test now: **Actions → Generate message → Run workflow**. It uses GitHub Models via the built-in `GITHUB_TOKEN` (free tier easily covers a few calls/day) and falls back to the hand-written banks on any failure. Nugget sources (Hacker News, arXiv, a free facts API) need no auth.

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

# regenerate data locally (no token -> uses the fallback banks):
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

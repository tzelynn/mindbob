# mindbob

A calming wellness micro-site that shows a feel-good note, refreshed **twice a day** —
lighthearted in the morning, reflective in the evening. Hosted on GitHub Pages,
installable to a phone home screen as a PWA, and built to load instantly.

https://tzelynn.github.io/mindbob/

- **Auto mode** — the note is arranged with a little hand-drawn doodle in a calm layout.
- **Decorate mode** — move the note around, draw with a per-message colour palette, and erase your doodles (you can never erase the note itself).

## How it works

```
GitHub Actions (cron, 2×/day)
  └─ scripts/generate-message.mjs
       ├─ GitHub Models API (free, uses the built-in GITHUB_TOKEN)
       ├─ validate tone/length/dedupe ── on failure ─▶ data/fallback-bank.json
       └─ commit data/messages.json
                            │
GitHub Pages (static)  ◀────┘
  └─ index.html → fetch messages.json → theme + doodle + render
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
| `js/autoDecorate.js` / `js/customDecorate.js` | The two modes |
| `data/messages.json` | Generated notes (the live data) |
| `data/fallback-bank.json` | Hand-written notes used when the LLM is unavailable |
| `doodles/*.svg` + `index.json` | Doodle library + its manifest |
| `scripts/generate-message.mjs` | Cron worker |
| `scripts/build-doodle-manifest.mjs` | Regenerates `doodles/index.json` |
| `scripts/make-icons.py` | Regenerates PWA icons |
| `.github/workflows/generate-message.yml` | The twice-daily schedule |

## The twice-daily cron

`.github/workflows/generate-message.yml` runs at:

- `0 23 * * *` UTC → **07:00 SGT** → morning (lighthearted)
- `0 11 * * *` UTC → **19:00 SGT** → evening (reflective)

Edit those cron lines to match your timezone. To test now: **Actions → Generate message → Run workflow** and choose `am` or `pm`. It uses GitHub Models via the built-in `GITHUB_TOKEN` (free tier easily covers 2 calls/day) and falls back to `data/fallback-bank.json` on any failure.

## Adding doodles

Drop a new `.svg` into `doodles/` (line-art using `stroke="currentColor"` so it picks up the palette), then run:

```bash
node scripts/build-doodle-manifest.mjs
```

The cron also regenerates the manifest on every run, so simply committing an SVG is enough.

## Local development

```bash
python3 -m http.server 8765
# open http://localhost:8765/index.html        (auto mode)
# open http://localhost:8765/index.html#decorate  (decorate mode)

# regenerate data locally (no token -> uses the fallback bank):
node scripts/generate-message.mjs --slot=am
node scripts/build-doodle-manifest.mjs
python3 scripts/make-icons.py
```

## Install as a "widget"

Open the site on your phone → browser menu → **Add to Home Screen**. It launches
fullscreen (no browser chrome) showing the current note, and works offline via the
service worker. (True live home-screen widgets require a native app and are out of scope.)

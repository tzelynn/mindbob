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

## Module map

| File | Responsibility | Key export |
|------|----------------|-----------|
| `js/main.js` | Entry: load note, theme, render, mode toggle, SW | — |
| `js/messages.js` | Fetch + select current note | `getCurrentEntry()` |
| `js/palette.js` | Curated palettes; one per note | `paletteFor(seed)`, `applyPalette()` |
| `js/doodles.js` | Manifest load, pick + place doodle | `renderAutoDoodle()` |
| `js/autoDecorate.js` | Auto mode render | `renderAuto()`, `clearAuto()` |
| `js/customDecorate.js` | Decorate canvas (move/pencil/eraser/save) | `createCustomDecorator()` |
| `js/util.js` | Hash + seeded RNG | `hashString()`, `seededRng()`, `pick()` |
| `js/pwa.js` | Service worker registration | `registerSW()` |

Keep modules single-purpose and small. `customDecorate.js` is lazy-imported by `main.js` only when entering decorate mode.

## Conventions

- **Deterministic-per-note visuals.** Palette and doodle are derived from the note `id` via `hashString` — same note always looks identical, AM ≠ PM, each note gets its own cohesive pencil palette. Don't introduce `Math.random()` for visuals; seed from the note id.
- **Theme via CSS custom properties** (`--bg`, `--ink`, `--accent`) set on `.app` by `applyPalette()`. Add new themeable colors as variables, not hardcoded values.
- **Doodles are inline SVG line-art using `stroke="currentColor"`** so they inherit `--accent`. New doodles must follow this (viewBox `0 0 100 100`, no hardcoded colors).

## Invariants to preserve

- **The note can never be erased.** It's a separate DOM layer (`#messageEl`) above the drawing `<canvas>`. The eraser uses `globalCompositeOperation = "destination-out"` on the canvas only. Never merge the note into the canvas (except in `save()`, which composites a throwaway export canvas).
- **`.toolbar[hidden]` needs an explicit `display:none` rule** — the author `.toolbar{display:flex}` otherwise overrides the `hidden` attribute. (Same trap applies to any element given a `display` and toggled via `hidden`.)
- Canvas drawing is DPR-aware (`fitCanvas`) and stores strokes in CSS pixels.

## Commands

```bash
# local preview
python3 -m http.server 8765
#   http://localhost:8765/index.html           (auto)
#   http://localhost:8765/index.html#decorate   (decorate mode — also used for testing)

# regenerate data (no token locally -> uses fallback bank)
node scripts/generate-message.mjs --slot=am|pm
node scripts/build-doodle-manifest.mjs   # after adding/removing doodles/*.svg
python3 scripts/make-icons.py            # after changing brand colors
```

## Verifying UI changes

There's a `chromium` binary available for headless screenshots. **Snap confinement blocks writing screenshots into the scratchpad/tmp — write them under `/home/<user>/` instead.** For interaction tests (drawing, clicks), drive Chrome via the DevTools Protocol (`--remote-debugging-port`) using Node's global `fetch`/`WebSocket`; `Input.dispatchMouseEvent` triggers the app's pointer-event handlers.

## Cron timing

`.github/workflows/generate-message.yml` schedules run in **UTC**; current values target Singapore time (`0 23` = 07:00 SGT AM, `0 11` = 19:00 SGT PM). The slot is resolved from `github.event.schedule` (or the `workflow_dispatch` input). Adjust the cron lines if the target timezone changes.

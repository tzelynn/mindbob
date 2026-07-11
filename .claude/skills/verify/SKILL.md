---
name: verify
description: Build/launch/drive recipe for verifying mindbob UI changes end-to-end with headless chromium over CDP
---

# Verifying mindbob changes

## Launch

```bash
# site (from repo root)
python3 -m http.server 8765 &

# browser — snap chromium; profile/downloads MUST live under /home/<user>/
# (snap confinement blocks /tmp and the scratchpad)
/usr/bin/chromium-browser --headless=new --disable-gpu --no-first-run \
  --remote-debugging-port=9333 --user-data-dir=/home/<user>/mindbob-verify/profile \
  --window-size=800,600 about:blank &
# wait ~5s, then: curl -s http://localhost:9333/json/version
```

## Drive (Node script, global fetch + WebSocket, no deps)

- Connect to `webSocketDebuggerUrl` from `/json/version`; `Target.createTarget`
  + `Target.attachToTarget {flatten:true}`; send commands with a `sessionId`.
- Clicks: measure center via `Runtime.evaluate` + `getBoundingClientRect`, then
  `Input.dispatchMouseEvent` mousePressed/mouseReleased. Swipes/strokes: add
  interpolated mouseMoved steps between press and release — this drives the
  app's real pointer-event handlers (swipe nav, canvas drawing).
- Screenshots: `Page.captureScreenshot` → write the base64 yourself (your
  process isn't confined; write anywhere).
- Downloads (e.g. doodle save): `Browser.setDownloadBehavior {behavior:"allow",
  downloadPath:"/home/<user>/..."}` on the browser connection, then click save.
- Phone viewport: `Emulation.setDeviceMetricsOverride {width:390, height:740,
  deviceScaleFactor:2, mobile:true}`.

## Gotchas (each cost a debugging round)

- **Hash-mode tests need a fresh tab.** `Page.navigate` to `index.html#mood`
  from an already-loaded page is a same-document navigation — `main.js` never
  re-runs and the mode won't change. Create a new target per hash case.
- **Measure click targets only after images finish decoding.** The gallery
  viewer's `<img>` reflows the buttons below it when it decodes; measuring
  before that lands the click on the wrong button. Wait/re-measure right
  before dispatching.
- **In doodle mode the canvas spans the centre** (`min(78vw,360px)` wide,
  centred). Stage swipes must start in the true margin (x outside the canvas
  box) or they're deliberately ignored — that's the drawing/swipe guard, not
  a bug.
- Read-tool image previews can show phantom bands on flat-colour PNGs; when a
  screenshot looks off, sample actual pixels (decode the PNG) before calling
  it a bug.

## Useful assertions from the page

```js
document.getElementById("app").dataset.mode          // current mode
import("./js/galleryStore.js").then(m => m.getAllEntries())  // IDB contents
localStorage.getItem("mindbob:doodle:<date>")        // per-day doodle payload
```

Generator scripts: run without `GITHUB_TOKEN` for the fallback path; re-run the
same day to verify the upgrade-only no-op (`git diff --quiet data/`); force with
`FORCE_REGENERATE=1`. Restore with `git checkout -- data/` when done.

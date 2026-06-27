# Doodle Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "decorate" tab (draw-around-the-note) with a "doodle" tab that shows a daily one-word drawing prompt above a bounded portrait canvas.

**Architecture:** A new `js/prompts.js` picks a date-seeded word from a bundled list (same deterministic pattern as palettes/doodles). `js/customDecorate.js` is rewritten as `js/doodleDecorate.js`: drawing-only (no draggable note, no move tool), a rounded portrait canvas with clipped strokes, persistence keyed per day. `index.html` / `styles.css` / `js/main.js` rename the mode `custom`→`doodle`, render the prompt, and restyle the canvas. `sw.js` updates its cached shell list.

**Tech Stack:** Vanilla HTML/CSS/JS, ES modules, served statically. No build step, no npm dependencies, all paths relative.

## Global Constraints

- **No framework, no build step, no bundler, no npm dependencies for the site.** Vanilla HTML/CSS/JS ES modules only.
- **All paths relative** (`./js/...`, `./data/...`). Never absolute.
- **Deterministic-per-seed visuals — no `Math.random()`.** Seed from the date/id using `hashString`/`pick` from `js/util.js`.
- **No unit-test framework exists.** Verify in the browser: `python3 -m http.server 8765`, then headless `chromium` and/or the DevTools Protocol (`--remote-debugging-port`). **Screenshots must be written under `/home/tzelynn/` — snap confinement blocks `/tmp` and the scratchpad.**
- **`.toolbar[hidden]` needs the explicit `display:none` rule** (author `display:flex` overrides `[hidden]`). Do not remove it.
- Canvas drawing stays DPR-aware; strokes stored in CSS pixels.
- Commit after every task.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `js/prompts.js` | Curated word list + `promptFor(dateSeed)` date-seeded pick | **Create** |
| `js/doodleDecorate.js` | Drawing-only bounded canvas, per-day persistence, save | **Create** (replaces `customDecorate.js`) |
| `js/customDecorate.js` | (old decorate-mode controller) | **Delete** in Task 3 |
| `index.html` | Tab label/id, prompt element, canvas/toolbar markup | **Modify** |
| `styles.css` | `data-mode` `custom`→`doodle`, portrait canvas, prompt, hide note | **Modify** |
| `js/main.js` | Mode rename, lazy-import doodle controller, render prompt | **Modify** |
| `sw.js` | Cache version bump + shell asset list swap | **Modify** |
| `CLAUDE.md` | Update module map / commands referencing decorate | **Modify** in Task 4 |

---

## Task 1: Daily doodle prompt module (`js/prompts.js`)

**Files:**
- Create: `js/prompts.js`

**Interfaces:**
- Consumes: `hashString` from `js/util.js` (existing: `export function hashString(str)` → uint32). Note: `pick(arr, seedStr, salt)` in `util.js` returns `arr[hashString(seedStr + "|" + salt) % arr.length]`.
- Produces: `export function promptFor(dateSeed)` → a single lowercase noun (string). `dateSeed` is a `YYYY-MM-DD` string (the entry's `date`). Same seed → same word.

- [ ] **Step 1: Create `js/prompts.js`**

```js
// Daily doodle prompt: one random single-word object, chosen deterministically
// from the date so everyone sees the same word on a given day (AM == PM) and it
// works offline. Same seeding pattern as palette.js / doodles.js — no Math.random.
import { hashString } from "./util.js";

// Curated simple, drawable single-word nouns.
export const WORDS = [
  "cat", "dog", "house", "tree", "flower", "sun", "moon", "star",
  "cloud", "boat", "car", "bus", "train", "plane", "bike", "fish",
  "bird", "frog", "bee", "snail", "butterfly", "cup", "mug", "teapot",
  "spoon", "fork", "hat", "shoe", "sock", "shirt", "umbrella", "key",
  "lamp", "candle", "clock", "book", "pencil", "brush", "kite", "balloon",
  "gift", "cake", "apple", "banana", "carrot", "mushroom", "leaf", "cactus",
  "palm", "anchor", "shell", "crab", "whale", "owl", "fox", "bear",
  "rabbit", "mouse", "ghost", "robot", "rocket", "planet", "mountain",
  "bridge", "tent", "guitar", "drum", "bell", "heart", "ladder",
];

// Pick one word for the given date seed (YYYY-MM-DD).
export function promptFor(dateSeed) {
  return WORDS[hashString("prompt|" + dateSeed) % WORDS.length];
}
```

- [ ] **Step 2: Verify determinism + membership in the browser**

Run:
```bash
cd "/mnt/c/Users/tze lynn/Documents/Coding/mindbob" && python3 -m http.server 8765 &
chromium --headless --no-sandbox --remote-debugging-port=9222 "http://localhost:8765/index.html" &
```
Then via the DevTools Protocol (Node `fetch`/`WebSocket` to `http://localhost:9222/json`), evaluate in the page:
```js
import('./js/prompts.js').then(m => JSON.stringify({
  a: m.promptFor('2026-06-27'),
  b: m.promptFor('2026-06-27'),
  c: m.promptFor('2026-06-28'),
  inList: m.WORDS.includes(m.promptFor('2026-06-27')),
  count: m.WORDS.length,
}))
```
Expected: `a === b` (deterministic), `a` is a single lowercase word, `inList === true`, `count === 69`. `c` may differ from `a`.

- [ ] **Step 3: Commit**

```bash
cd "/mnt/c/Users/tze lynn/Documents/Coding/mindbob"
git add js/prompts.js
git commit -m "feat: add date-seeded daily doodle prompt module"
```

---

## Task 2: Drawing-only doodle controller (`js/doodleDecorate.js`)

Create the new controller alongside the old one (do **not** delete `customDecorate.js` yet — `main.js` still imports it until Task 3, so the app keeps working between commits).

**Files:**
- Create: `js/doodleDecorate.js`

**Interfaces:**
- Consumes (from `refs`): `app`, `canvas`, `stage`. From `state`: `palette` (has `bg`, `pencil[]`), `entry.date` (`YYYY-MM-DD`), and `promptWord` (string, set by `main.js` in Task 3 — used only for the save filename).
- Consumes DOM ids (already in `index.html`, updated in Task 3): `toolPencil`, `toolEraser`, `toolUndo`, `toolClear`, `toolSave`, `swatches`, `drawCanvas`.
- Produces: `export function createDoodleDecorator(refs, state)` → `{ activate(), deactivate() }`.

- [ ] **Step 1: Create `js/doodleDecorate.js`**

```js
// DOODLE mode: a bounded portrait canvas the user draws on for the day's
// one-word prompt. No draggable note, no move tool — the canvas is the only
// drawable surface. Strokes are clipped to the rounded rectangle.
// Tools: pencil (seeded palette) / eraser. Undo snapshots canvas pixels only.

const STORE_PREFIX = "mindbob:doodle:";

export function createDoodleDecorator(refs, state) {
  const { canvas } = refs;
  const ctx = canvas.getContext("2d");

  let tool = "pencil";
  let color = state.palette.pencil[0];
  let dpr = 1;
  let drawing = false;
  let lastX = 0, lastY = 0;

  // undo: each entry snapshots the canvas pixels taken *before* an action
  // (stroke, erase, clear). Undo restores the top.
  const undoStack = [];
  const MAX_UNDO = 40;

  const buttons = {
    pencil: document.getElementById("toolPencil"),
    eraser: document.getElementById("toolEraser"),
  };
  const undoBtn = () => document.getElementById("toolUndo");

  function snapshot() {
    return canvas.width > 0
      ? ctx.getImageData(0, 0, canvas.width, canvas.height)
      : null;
  }

  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    refreshUndoBtn();
  }

  function undo() {
    if (!undoStack.length) return;
    const img = undoStack.pop();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (img) ctx.putImageData(img, 0, 0); // putImageData ignores transform + clip
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    refreshUndoBtn();
    persist();
  }

  function refreshUndoBtn() {
    const b = undoBtn();
    if (b) b.disabled = undoStack.length === 0;
  }

  // ---------- persistence (per-day, survives reloads) ----------
  // Decoration (canvas pixels) is saved under the current day's date and
  // restored on re-entry. Only the current day's doodle is kept; a new day has
  // no saved state, so it "refreshes" with the prompt.
  function storageKey() {
    return STORE_PREFIX + state.entry.date;
  }

  function persist() {
    try {
      const payload = JSON.stringify({
        img: canvas.width > 0 ? canvas.toDataURL("image/png") : null,
      });
      const key = storageKey();
      // prune any other day's doodle so storage stays bounded
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith(STORE_PREFIX) && k !== key) localStorage.removeItem(k);
      }
      localStorage.setItem(key, payload);
    } catch {
      // localStorage disabled/full — degrade to in-memory only
    }
  }

  // Restore runs once per load: after the first entry to doodle mode the
  // in-memory canvas is the source of truth.
  let restored = false;
  function restore() {
    if (restored) return;
    restored = true;
    let payload = null;
    try {
      const raw = localStorage.getItem(storageKey());
      if (raw) payload = JSON.parse(raw);
    } catch {
      return;
    }
    if (!payload || !payload.img) return;
    const img = new Image();
    img.onload = () => {
      // redraw scaled to the live canvas size (absorbs DPR/resize differences)
      const rect = canvas.getBoundingClientRect();
      ctx.drawImage(img, 0, 0, rect.width, rect.height);
    };
    img.src = payload.img;
  }

  // ---------- canvas sizing (DPR-aware, rounded clip, preserves drawing) ----------
  function fitCanvas() {
    const rect = canvas.getBoundingClientRect(); // CSS size set by styles.css
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const prev = canvas.width > 0
      ? ctx.getImageData(0, 0, canvas.width, canvas.height)
      : null;

    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    clipToRounded(rect); // confine strokes to the rounded rectangle

    if (prev) ctx.putImageData(prev, 0, 0); // best-effort restore
  }

  // r MUST match .layer-canvas border-radius in styles.css.
  function clipToRounded(rect) {
    const r = 28;
    ctx.beginPath();
    ctx.roundRect(0, 0, rect.width, rect.height, r);
    ctx.clip();
  }

  // ---------- tool selection ----------
  function setTool(next) {
    tool = next;
    for (const [name, btn] of Object.entries(buttons)) {
      const on = name === next;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", String(on));
    }
    canvas.style.pointerEvents = "auto"; // both pencil and eraser draw
  }

  // ---------- swatches ----------
  function buildSwatches() {
    const wrap = document.getElementById("swatches");
    wrap.innerHTML = "";
    state.palette.pencil.forEach((c, i) => {
      const b = document.createElement("button");
      b.className = "swatch" + (i === 0 ? " is-active" : "");
      b.style.background = c;
      b.title = c;
      b.setAttribute("aria-label", "colour " + c);
      b.addEventListener("click", () => {
        color = c;
        if (tool !== "pencil") setTool("pencil");
        wrap.querySelectorAll(".swatch").forEach((s) => s.classList.remove("is-active"));
        b.classList.add("is-active");
      });
      wrap.appendChild(b);
    });
  }

  // ---------- drawing ----------
  function pos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onCanvasDown(e) {
    pushUndo(); // snapshot before this stroke/erase begins
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    const p = pos(e);
    lastX = p.x;
    lastY = p.y;
    strokeTo(p.x + 0.01, p.y + 0.01); // a dot, so taps leave a mark
  }

  function onCanvasMove(e) {
    if (!drawing) return;
    const p = pos(e);
    strokeTo(p.x, p.y);
    lastX = p.x;
    lastY = p.y;
  }

  function onCanvasUp(e) {
    if (!drawing) return;
    drawing = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch {}
    persist();
  }

  function strokeTo(x, y) {
    ctx.globalCompositeOperation =
      tool === "eraser" ? "destination-out" : "source-over";
    ctx.strokeStyle = color;
    ctx.lineWidth = tool === "eraser" ? 26 : 5;
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  // ---------- clear / save ----------
  function clearDrawing() {
    pushUndo(); // clear is undoable too
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    persist();
  }

  function save() {
    const rect = canvas.getBoundingClientRect();
    const out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = canvas.height;
    const o = out.getContext("2d");
    o.setTransform(dpr, 0, 0, dpr, 0, 0);
    // background + drawing (no prompt text baked in)
    o.fillStyle = state.palette.bg;
    o.fillRect(0, 0, rect.width, rect.height);
    o.drawImage(canvas, 0, 0, rect.width, rect.height);

    out.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename();
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  }

  // mindbob_<prompt>_<date>.png — unique per day; empty parts dropped.
  function filename() {
    const parts = ["mindbob", state.promptWord, state.entry.date];
    return parts.filter(Boolean).join("_") + ".png";
  }

  // ---------- lifecycle ----------
  let wired = false;
  function wireOnce() {
    if (wired) return;
    wired = true;
    buttons.pencil.addEventListener("click", () => setTool("pencil"));
    buttons.eraser.addEventListener("click", () => setTool("eraser"));
    document.getElementById("toolUndo").addEventListener("click", undo);
    document.getElementById("toolClear").addEventListener("click", clearDrawing);
    document.getElementById("toolSave").addEventListener("click", save);

    canvas.addEventListener("pointerdown", onCanvasDown);
    canvas.addEventListener("pointermove", onCanvasMove);
    canvas.addEventListener("pointerup", onCanvasUp);
    canvas.addEventListener("pointercancel", onCanvasUp);

    window.addEventListener("resize", () => {
      if (refs.app.dataset.mode === "doodle") fitCanvas();
    });
  }

  function activate() {
    wireOnce();
    buildSwatches();
    color = state.palette.pencil[0];
    canvas.setAttribute("aria-hidden", "false");
    fitCanvas();
    restore(); // re-apply this day's saved doodle, if any
    setTool("pencil");
    refreshUndoBtn();
  }

  function deactivate() {
    canvas.style.pointerEvents = "none";
    canvas.setAttribute("aria-hidden", "true");
  }

  return { activate, deactivate };
}
```

- [ ] **Step 2: Verify the module parses (no syntax errors)**

With the server running, evaluate in the page via DevTools:
```js
import('./js/doodleDecorate.js').then(m => typeof m.createDoodleDecorator)
```
Expected: `"function"`. (It is not wired into the app yet — that happens in Task 3.)

- [ ] **Step 3: Commit**

```bash
cd "/mnt/c/Users/tze lynn/Documents/Coding/mindbob"
git add js/doodleDecorate.js
git commit -m "feat: add drawing-only doodle controller (bounded canvas, per-day persist)"
```

---

## Task 3: Switch the app to doodle mode (HTML + CSS + main.js)

This is the cut-over: rename the tab, render the prompt, restyle the canvas to a portrait rounded rectangle, remove the move tool, hide the note in doodle mode, and lazy-import the new controller. Old `customDecorate.js` is deleted here because nothing imports it after this task.

**Files:**
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `js/main.js`
- Delete: `js/customDecorate.js`

**Interfaces:**
- Consumes: `promptFor(dateSeed)` (Task 1), `createDoodleDecorator(refs, state)` (Task 2).
- Produces: `state.promptWord` (string) set in `main.js` before entering doodle mode; the controller reads it for the save filename.

- [ ] **Step 1: Update `index.html` — tab label/id, prompt element, canvas class, toolbar**

Replace the mode-toggle button (line 28):
```html
        <button id="modeCustom" class="mode-btn" role="tab" aria-selected="false">decorate</button>
```
with:
```html
        <button id="modeDoodle" class="mode-btn" role="tab" aria-selected="false">doodle</button>
```

Replace the canvas + doodle + message block (lines 34–44) with a prompt, a bounded canvas, and the (now doodle-hidden) note/auto-doodle layers:
```html
      <!-- daily doodle prompt (doodle mode only) -->
      <div id="doodlePrompt" class="doodle-prompt" aria-hidden="true">draw <strong id="doodleWord"></strong></div>

      <!-- bounded drawing canvas (doodle mode only) -->
      <canvas id="drawCanvas" class="layer-canvas" aria-hidden="true"></canvas>

      <!-- doodle (auto mode) -->
      <div id="doodleLayer" class="layer layer-doodle" aria-hidden="true"></div>

      <!-- the message (auto mode) -->
      <div id="messageEl" class="layer layer-message">
        <p id="messageText" class="message-text">…</p>
      </div>
```
(Note: the canvas loses the `layer` class — it is now centered by its own rule, not `inset:0`.)

Replace the tool-group "Tools" block (lines 48–52) — remove the move button:
```html
      <div class="tool-group" role="group" aria-label="Tools">
        <button id="toolPencil" class="tool-btn is-active" title="Draw" aria-pressed="true">pencil</button>
        <button id="toolEraser" class="tool-btn" title="Erase" aria-pressed="false">eraser</button>
      </div>
```

- [ ] **Step 2: Update `styles.css` — portrait canvas, prompt, hide note, drop move/`custom` rules**

Replace the `.layer-canvas` block + the auto-hide rule (lines 101–111):
```css
/* Bounded portrait drawing surface — a rounded vertical rectangle, centred,
   shown only in doodle mode. JS confines strokes to the same rounded shape. */
.layer-canvas {
  position: absolute;
  left: 50%;
  top: 54%;
  transform: translate(-50%, -50%);
  width: min(78vw, 360px);
  height: min(70vh, 560px);
  border-radius: 28px;            /* must match clipToRounded() r in doodleDecorate.js */
  background: rgba(255, 255, 255, 0.4);
  box-shadow: 0 2px 16px rgba(0, 0, 0, 0.08);
  touch-action: none;             /* we handle pointer drawing ourselves */
  pointer-events: none;           /* enabled in doodle mode by JS */
}

/* Canvas is doodle-mode only; hidden in auto so it never shows behind doodles. */
.app[data-mode="auto"] .layer-canvas { display: none; }

/* daily prompt: top of the stage, doodle mode only */
.doodle-prompt {
  position: absolute;
  top: 7%;
  left: 0;
  right: 0;
  text-align: center;
  font-size: clamp(1.4rem, 5.5vw, 2.4rem);
  color: var(--ink);
  pointer-events: none;
  display: none;
}
.doodle-prompt strong { color: var(--accent); font-weight: inherit; }
.app[data-mode="doodle"] .doodle-prompt { display: block; }

/* the note belongs to auto mode only */
.app[data-mode="doodle"] .layer-message { display: none; }
```

Delete the now-obsolete drag rules (lines 148–156):
```css
/* In custom mode the whole centred message layer can be dragged
   (translate offset is applied via JS), so the text moves as a unit. */
.app[data-mode="custom"] .layer-message { will-change: transform; }
.app[data-mode="custom"] .layer-message.is-draggable {
  cursor: grab;
  pointer-events: auto;
  touch-action: none;        /* stop the browser hijacking touch-drags as scroll */
}
.app[data-mode="custom"] .layer-message.is-dragging { cursor: grabbing; }
```
(Delete the whole block above; replace with nothing.)

Update the status-hide selector (line 217) from `custom` to `doodle`:
```css
.app[data-mode="doodle"] .status { display: none; }
```

- [ ] **Step 3: Update `js/main.js` — refs, prompt, mode names, lazy import**

Replace the import line (line 3 region) to add the prompt module. After the existing imports, add:
```js
import { promptFor } from "./prompts.js";
```

In `refs` (lines 8–19), rename `modeCustom` and add `doodleWord`:
```js
const refs = {
  app: document.getElementById("app"),
  stage: document.getElementById("stage"),
  canvas: document.getElementById("drawCanvas"),
  doodleLayer: document.getElementById("doodleLayer"),
  messageEl: document.getElementById("messageEl"),
  messageText: document.getElementById("messageText"),
  toolbar: document.getElementById("toolbar"),
  status: document.getElementById("status"),
  modeAuto: document.getElementById("modeAuto"),
  modeDoodle: document.getElementById("modeDoodle"),
  doodleWord: document.getElementById("doodleWord"),
};
```

In `state` (lines 21–26), add `promptWord` and rename `custom`→`doodle`:
```js
const state = {
  entry: null,
  palette: null,
  mode: "auto",
  promptWord: "",
  doodle: null, // lazily-loaded doodle controller
};
```

In `init()`, after setting the message text (line 35 area), add prompt computation + render and switch the start-mode hash + listeners:
```js
  refs.messageText.textContent = state.entry.text;
  refs.status.textContent = statusLine(state.entry);

  state.promptWord = promptFor(state.entry.date);
  refs.doodleWord.textContent = state.promptWord;

  const startMode = location.hash === "#doodle" ? "doodle" : "auto";
  await setMode(startMode);
  refs.app.classList.remove("is-loading");

  refs.modeAuto.addEventListener("click", () => setMode("auto"));
  refs.modeDoodle.addEventListener("click", () => setMode("doodle"));

  registerSW();
```

Replace `setMode()` (lines 53–78) entirely:
```js
async function setMode(mode) {
  state.mode = mode;
  refs.app.dataset.mode = mode;

  const isAuto = mode === "auto";
  refs.modeAuto.classList.toggle("is-active", isAuto);
  refs.modeDoodle.classList.toggle("is-active", !isAuto);
  refs.modeAuto.setAttribute("aria-selected", String(isAuto));
  refs.modeDoodle.setAttribute("aria-selected", String(!isAuto));
  refs.toolbar.hidden = isAuto;

  if (isAuto) {
    if (state.doodle) state.doodle.deactivate();
    await renderAuto(refs, state.entry);
  } else {
    clearAuto(refs);
    if (!state.doodle) {
      const mod = await import("./doodleDecorate.js");
      state.doodle = mod.createDoodleDecorator(refs, state);
    }
    state.doodle.activate();
  }
}
```

- [ ] **Step 4: Delete the old controller**

```bash
cd "/mnt/c/Users/tze lynn/Documents/Coding/mindbob"
git rm js/customDecorate.js
```

- [ ] **Step 5: Verify the full doodle flow in the browser**

Restart the server/headless Chrome if needed (server root = repo). Then:

1. Load `http://localhost:8765/index.html` — auto mode shows the note (unchanged). Screenshot to `/home/tzelynn/doodle-auto.png`.
2. Click the **doodle** tab (DevTools `Input.dispatchMouseEvent` on the `#modeDoodle` button, or load `#doodle`). Verify:
   - The prompt `draw <word>` shows at the top; `#doodleWord` text equals `promptFor(<today>)` and is non-empty.
   - The note (`#messageEl`) is hidden; a rounded portrait canvas is visible.
   - The toolbar shows pencil / eraser / swatches / undo / clear / save and **no move button** (`document.getElementById('toolMove') === null`).
   Screenshot to `/home/tzelynn/doodle-mode.png`.
3. Draw: dispatch `pointerdown`→several `pointermove`→`pointerup` **inside** the canvas rect; confirm a visible stroke. Then attempt a `pointerdown` **outside** the canvas box — confirm no stroke appears there (canvas only captures within its element; clip keeps strokes inside the rounded corners).
4. Click **undo** — the last stroke is removed; **undo** disabled when stack empty. Click **clear** — canvas empties.
5. Draw again, then evaluate the would-be filename:
   ```js
   // confirm the download name format without triggering a download
   `mindbob_${document.getElementById('doodleWord').textContent}_${new Date().toISOString().slice(0,10)}.png`
   ```
   Expected shape: `mindbob_<word>_YYYY-MM-DD.png` (no `am`/`pm`, no theme name).
6. Reload the page in doodle mode — the drawn strokes are restored (per-day persistence). Confirm `localStorage` has exactly one `mindbob:doodle:<date>` key and no `mindbob:decoration:*` keys.

Expected: all observations hold; no console errors.

- [ ] **Step 6: Commit**

```bash
cd "/mnt/c/Users/tze lynn/Documents/Coding/mindbob"
git add index.html styles.css js/main.js
git commit -m "feat: switch decorate tab to doodle tab (prompt + bounded canvas)"
```

---

## Task 4: Service worker cache + docs

**Files:**
- Modify: `sw.js`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: the new file names from Tasks 1–3.

- [ ] **Step 1: Update `sw.js` — bump version, swap shell assets**

Change the version (line 7):
```js
const VERSION = "v2";
```

In `SHELL_ASSETS` (lines 11–27), replace `"./js/customDecorate.js"` with the two new modules:
```js
  "./js/autoDecorate.js",
  "./js/doodleDecorate.js",
  "./js/prompts.js",
  "./js/util.js",
```
(Remove the `"./js/customDecorate.js"` line; keep all other entries.)

- [ ] **Step 2: Update `CLAUDE.md` references**

In the module-map table, replace the `js/customDecorate.js` row and add `js/prompts.js`:
```
| `js/doodleDecorate.js` | Bounded doodle canvas (pencil/eraser/undo/clear/save) + per-day persistence | `createDoodleDecorator()` |
| `js/prompts.js` | Daily date-seeded doodle prompt word | `promptFor(dateSeed)` |
```
In the same file: update the lazy-import note (`customDecorate.js` → `doodleDecorate.js`), the local-preview testing hash (`index.html#decorate` → `index.html#doodle`), and the saved-image filename invariant (`mindbob_<theme>_<date>_<slot>.png` → `mindbob_<prompt>_<date>.png`; the doodle has no slot). Remove/realign the "note can never be erased" and move-tool wording so it reflects doodle mode (the note is not present in doodle mode; there is no move tool).

- [ ] **Step 3: Verify cache update serves the new shell**

With the server running, load the site, then in DevTools confirm the active service worker caches the new files:
```js
caches.open('mindbob-shell-v2')
  .then(c => c.keys())
  .then(ks => ks.map(r => new URL(r.url).pathname).filter(p => p.includes('/js/')))
```
Expected: includes `/js/doodleDecorate.js` and `/js/prompts.js`, excludes `/js/customDecorate.js`. (You may need to reload twice for the new SW to activate, or use DevTools "Update on reload".)

- [ ] **Step 4: Commit**

```bash
cd "/mnt/c/Users/tze lynn/Documents/Coding/mindbob"
git add sw.js CLAUDE.md
git commit -m "chore: cache doodle modules in SW; update docs"
```

---

## Self-Review

**Spec coverage:**
- Daily single-word prompt, seeded → Task 1 (`promptFor`, date seed). ✅
- Same palettes stay → unchanged `palette.js`; doodle uses `state.palette` (noted in spec §Palette). ✅
- Prompt at top, rounded vertical rectangle canvas below → Task 3 (`.doodle-prompt`, portrait `.layer-canvas`). ✅
- Drawing only within the canvas → Task 2 (`clipToRounded` + canvas-bounded pointer events). ✅
- Move tool removed → Task 3 (HTML button removed) + Task 2 (no move logic). ✅
- Saving includes the prompt, am/pm removed → Task 2 (`filename()` = `mindbob_<prompt>_<date>.png`). ✅
- PNG contains canvas drawing only (user choice) → Task 2 (`save()` drops text baking). ✅
- Per-day persistence → Task 2 (`mindbob:doodle:<date>`). ✅

**Placeholder scan:** No TBD/TODO; all code blocks are complete. ✅

**Type/name consistency:** `promptFor(dateSeed)` produced in Task 1, consumed in Task 3. `createDoodleDecorator(refs, state)` produced in Task 2, consumed in Task 3. `state.promptWord` set in Task 3, read by `filename()` in Task 2. `border-radius: 28px` (CSS) matches `clipToRounded` `r = 28` (JS). Mode value `"doodle"` consistent across HTML id `modeDoodle`, CSS `[data-mode="doodle"]`, and `main.js`. ✅

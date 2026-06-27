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

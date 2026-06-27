// CUSTOM mode: a layered canvas the user decorates.
//   Layer 1: palette background (the .app bg shows through)
//   Layer 2: <canvas> free-drawing  (pencil + eraser act ONLY here)
//   Layer 3: the message as a draggable DOM node (can never be erased)
// Tools: move (drag text) / pencil (seeded palette) / eraser.

const STORE_PREFIX = "mindbob:decoration:";

export function createCustomDecorator(refs, state) {
  const { canvas, messageEl, toolbar, stage } = refs;
  const ctx = canvas.getContext("2d");

  let tool = "move";
  let color = state.palette.pencil[0];
  let dpr = 1;
  let drawing = false;
  let lastX = 0, lastY = 0;

  // message position as translate() offsets, in CSS px from centre
  let msgX = 0, msgY = 0;
  let dragStart = null;

  // undo: each entry snapshots the canvas pixels + message position taken
  // *before* an action (stroke, erase, drag, clear). Undo restores the top.
  const undoStack = [];
  const MAX_UNDO = 40;

  const buttons = {
    move: document.getElementById("toolMove"),
    pencil: document.getElementById("toolPencil"),
    eraser: document.getElementById("toolEraser"),
  };
  const undoBtn = () => document.getElementById("toolUndo");

  function snapshot() {
    return {
      img: canvas.width > 0
        ? ctx.getImageData(0, 0, canvas.width, canvas.height)
        : null,
      msgX,
      msgY,
    };
  }

  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    refreshUndoBtn();
  }

  function undo() {
    const prev = undoStack.pop();
    if (!prev) return;
    if (prev.img) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.putImageData(prev.img, 0, 0); // putImageData ignores the transform
      ctx.restore();
    }
    msgX = prev.msgX;
    msgY = prev.msgY;
    applyMsgTransform();
    refreshUndoBtn();
    persist();
  }

  function refreshUndoBtn() {
    const b = undoBtn();
    if (b) b.disabled = undoStack.length === 0;
  }

  // ---------- persistence (per-note, survives reloads) ----------
  // Decoration (canvas pixels + message offset) is saved under the current
  // note's id and restored on re-entry. Only the current note's decoration is
  // kept; a new note simply has no saved state, so it "refreshes" with the note.
  function storageKey() {
    return STORE_PREFIX + state.entry.id;
  }

  function persist() {
    try {
      const payload = JSON.stringify({
        img: canvas.width > 0 ? canvas.toDataURL("image/png") : null,
        msgX,
        msgY,
      });
      const key = storageKey();
      // prune any other note's decoration so storage stays bounded
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith(STORE_PREFIX) && k !== key) localStorage.removeItem(k);
      }
      localStorage.setItem(key, payload);
    } catch {
      // localStorage disabled/full — degrade to in-memory only
    }
  }

  // Restore runs once per load: after the first entry to decorate mode the
  // in-memory canvas is the source of truth, so re-restoring on later mode
  // toggles would double-composite the saved bitmap onto identical pixels.
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
    if (!payload) return;
    if (typeof payload.msgX === "number") msgX = payload.msgX;
    if (typeof payload.msgY === "number") msgY = payload.msgY;
    applyMsgTransform();
    if (payload.img) {
      const img = new Image();
      img.onload = () => {
        // draw in CSS-pixel space (ctx is dpr-scaled) so the saved bitmap is
        // rescaled to the current canvas size, absorbing DPR/resize differences
        const rect = stage.getBoundingClientRect();
        ctx.drawImage(img, 0, 0, rect.width, rect.height);
      };
      img.src = payload.img;
    }
  }

  // ---------- canvas sizing (DPR-aware, preserves drawing on resize) ----------
  function fitCanvas() {
    const rect = stage.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const prev =
      canvas.width > 0
        ? ctx.getImageData(0, 0, canvas.width, canvas.height)
        : null;

    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (prev) ctx.putImageData(prev, 0, 0); // best-effort restore
  }

  // ---------- tool selection ----------
  function setTool(next) {
    tool = next;
    for (const [name, btn] of Object.entries(buttons)) {
      const on = name === next;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", String(on));
    }
    // canvas captures pointers only when drawing/erasing
    canvas.style.pointerEvents = next === "move" ? "none" : "auto";
    messageEl.classList.toggle("is-draggable", next === "move");
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
        // picking a colour always means "I want to draw"
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
    if (tool === "move") return;
    pushUndo(); // snapshot before this stroke/erase begins
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    const p = pos(e);
    lastX = p.x;
    lastY = p.y;
    // a dot, so taps leave a mark
    strokeTo(p.x + 0.01, p.y + 0.01);
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

  // ---------- move (drag the message) ----------
  function applyMsgTransform() {
    messageEl.style.transform = `translate(${msgX}px, ${msgY}px)`;
  }

  function onMsgDown(e) {
    if (tool !== "move") return;
    // remember where we started so undo can capture the pre-drag position,
    // but only commit that snapshot once the message actually moves.
    dragStart = { x: e.clientX - msgX, y: e.clientY - msgY, snapped: false };
    messageEl.classList.add("is-dragging");
    messageEl.setPointerCapture(e.pointerId);
  }
  function onMsgMove(e) {
    if (!dragStart) return;
    if (!dragStart.snapped) {
      pushUndo(); // snapshot the position before this drag's first move
      dragStart.snapped = true;
    }
    msgX = e.clientX - dragStart.x;
    msgY = e.clientY - dragStart.y;
    applyMsgTransform();
  }
  function onMsgUp(e) {
    if (!dragStart) return;
    dragStart = null;
    messageEl.classList.remove("is-dragging");
    try { messageEl.releasePointerCapture(e.pointerId); } catch {}
    persist();
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
    const rect = stage.getBoundingClientRect();
    const out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = canvas.height;
    const o = out.getContext("2d");
    o.setTransform(dpr, 0, 0, dpr, 0, 0);

    // background
    o.fillStyle = state.palette.bg;
    o.fillRect(0, 0, rect.width, rect.height);
    // drawing
    o.drawImage(canvas, 0, 0, rect.width, rect.height);
    // message text (rendered onto canvas so it's part of the export)
    drawMessageText(o, rect);

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

  // mindbob_<theme>_<date>_<slot>.png — unique per note; empty parts (e.g. the
  // offline fallback's blank date) are dropped so there are no doubled "_".
  function filename() {
    const parts = ["mindbob", state.palette.name, state.entry.date, state.entry.slot];
    return parts.filter(Boolean).join("_") + ".png";
  }

  function drawMessageText(o, rect) {
    const mRect = messageEl.getBoundingClientRect();
    const sRect = stage.getBoundingClientRect();
    const cx = mRect.left - sRect.left + mRect.width / 2;
    const cy = mRect.top - sRect.top + mRect.height / 2;

    const fontPx = parseFloat(getComputedStyle(refs.messageText).fontSize) || 32;
    o.fillStyle = state.palette.ink;
    o.textAlign = "center";
    o.textBaseline = "middle";
    o.font = `${fontPx}px Eggi, sans-serif`;

    const maxW = Math.min(rect.width * 0.8, 18 * fontPx * 0.6);
    const lines = wrapText(o, state.entry.text, maxW);
    const lh = fontPx * 1.25;
    const startY = cy - ((lines.length - 1) * lh) / 2;
    lines.forEach((line, i) => o.fillText(line, cx, startY + i * lh));
  }

  function wrapText(o, text, maxW) {
    const words = text.split(/\s+/);
    const lines = [];
    let line = "";
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (o.measureText(test).width > maxW && line) {
        lines.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  // ---------- lifecycle ----------
  let wired = false;
  function wireOnce() {
    if (wired) return;
    wired = true;
    buttons.move.addEventListener("click", () => setTool("move"));
    buttons.pencil.addEventListener("click", () => setTool("pencil"));
    buttons.eraser.addEventListener("click", () => setTool("eraser"));
    document.getElementById("toolUndo").addEventListener("click", undo);
    document.getElementById("toolClear").addEventListener("click", clearDrawing);
    document.getElementById("toolSave").addEventListener("click", save);

    canvas.addEventListener("pointerdown", onCanvasDown);
    canvas.addEventListener("pointermove", onCanvasMove);
    canvas.addEventListener("pointerup", onCanvasUp);
    canvas.addEventListener("pointercancel", onCanvasUp);

    messageEl.addEventListener("pointerdown", onMsgDown);
    messageEl.addEventListener("pointermove", onMsgMove);
    messageEl.addEventListener("pointerup", onMsgUp);
    messageEl.addEventListener("pointercancel", onMsgUp);

    window.addEventListener("resize", () => {
      if (refs.app.dataset.mode === "custom") fitCanvas();
    });
  }

  function activate() {
    wireOnce();
    buildSwatches();
    color = state.palette.pencil[0];
    canvas.setAttribute("aria-hidden", "false");
    // place message at its current centred spot, then make it movable
    applyMsgTransform();
    fitCanvas();
    restore(); // re-apply this note's saved decoration, if any
    setTool("move");
    refreshUndoBtn();
  }

  function deactivate() {
    canvas.style.pointerEvents = "none";
    messageEl.classList.remove("is-draggable", "is-dragging");
    canvas.setAttribute("aria-hidden", "true");
  }

  return { activate, deactivate };
}

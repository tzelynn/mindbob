// CUSTOM mode: a layered canvas the user decorates.
//   Layer 1: palette background (the .app bg shows through)
//   Layer 2: <canvas> free-drawing  (pencil + eraser act ONLY here)
//   Layer 3: the message as a draggable DOM node (can never be erased)
// Tools: move (drag text) / pencil (seeded palette) / eraser.

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

  const buttons = {
    move: document.getElementById("toolMove"),
    pencil: document.getElementById("toolPencil"),
    eraser: document.getElementById("toolEraser"),
  };

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
        if (tool === "eraser") setTool("pencil");
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
    dragStart = { x: e.clientX - msgX, y: e.clientY - msgY };
    messageEl.classList.add("is-dragging");
    messageEl.setPointerCapture(e.pointerId);
  }
  function onMsgMove(e) {
    if (!dragStart) return;
    msgX = e.clientX - dragStart.x;
    msgY = e.clientY - dragStart.y;
    applyMsgTransform();
  }
  function onMsgUp(e) {
    if (!dragStart) return;
    dragStart = null;
    messageEl.classList.remove("is-dragging");
    try { messageEl.releasePointerCapture(e.pointerId); } catch {}
  }

  // ---------- clear / save ----------
  function clearDrawing() {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
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
      a.download = "mindbob.png";
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
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
    setTool("move");
  }

  function deactivate() {
    canvas.style.pointerEvents = "none";
    messageEl.classList.remove("is-draggable", "is-dragging");
    canvas.setAttribute("aria-hidden", "true");
  }

  return { activate, deactivate };
}

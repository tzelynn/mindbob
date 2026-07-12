// DOODLE mode: a bounded portrait canvas the user draws on for the day's
// one-word prompt. No draggable note, no move tool — the canvas is the only
// drawable surface. Strokes are clipped to the rounded rectangle.
// Tools: pencil (seeded palette) / eraser. Undo snapshots canvas pixels only.
// Past days' drawings are archived into the IndexedDB gallery on activation,
// before the per-day localStorage prune would drop them.

import { doodlePaletteFor } from "./palette.js";
import { promptFor } from "./prompts.js";

const STORE_PREFIX = "mindbob:doodle:";

export function createDoodleDecorator(refs, state) {
  const { canvas } = refs;
  const ctx = canvas.getContext("2d");

  let tool = "pencil";
  let color = state.doodlePalette.pencil[0];
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
      // word + palette ride along so the archive can label past doodles
      const payload = JSON.stringify({
        img: canvas.width > 0 ? canvas.toDataURL("image/png") : null,
        word: state.promptWord,
        palette: {
          bg: state.doodlePalette.bg,
          ink: state.doodlePalette.ink,
          accent: state.doodlePalette.accent,
        },
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

  // ---------- gallery archive (past days -> IndexedDB) ----------
  // persist() prunes every non-current-day key, so past days must be captured
  // here, synchronously, before the user's first stroke can trigger a prune.
  // The payload strings are read up front; the conversion/store is async.
  let archived = false;
  function archiveStale() {
    if (archived) return;
    archived = true;
    const stale = [];
    try {
      const key = storageKey();
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(STORE_PREFIX) || k === key) continue;
        const p = JSON.parse(localStorage.getItem(k));
        if (p && p.img) stale.push({ date: k.slice(STORE_PREFIX.length), ...p });
      }
    } catch {
      return; // storage unavailable — nothing to archive
    }
    if (!stale.length) return;
    import("./galleryStore.js")
      .then(async (store) => {
        for (const s of stale) await archiveOne(store, s);
      })
      .catch(() => {});
  }

  async function archiveOne(store, { date, img, word, palette }) {
    // legacy {img}-only payloads: backfill the day's deterministic palette
    const pal = palette || doodlePaletteFor(date);
    const image = await loadImage(img);
    if (!image) return;
    const scale = Math.min(1, 640 / Math.max(image.width, image.height));
    const c = document.createElement("canvas");
    c.width = Math.round(image.width * scale);
    c.height = Math.round(image.height * scale);
    const cx = c.getContext("2d");
    cx.drawImage(image, 0, 0, c.width, c.height);
    if (isBlank(cx, c)) return; // empty days don't enter the gallery
    // Bake a neutral white behind the strokes (lossy formats have no alpha).
    // We deliberately do NOT use the day's bg tint — every gallery thumbnail
    // should read on the same neutral ground, not a per-day colour.
    cx.globalCompositeOperation = "destination-over";
    cx.fillStyle = "#ffffff";
    cx.fillRect(0, 0, c.width, c.height);
    const blob = await encodeThumb(c);
    if (!blob) return;
    const ok = await store.putEntry({
      date,
      blob,
      type: blob.type,
      word: word || promptFor(date), // the day's date-seeded prompt, never blank
      palette: pal,
    });
    // only drop the localStorage copy once it's safely in IndexedDB
    if (ok) {
      try {
        localStorage.removeItem(STORE_PREFIX + date);
      } catch {}
    }
  }

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  // Any visible pixel? Sampled with a stride — exactness doesn't matter, a
  // single stray dot either way is fine.
  function isBlank(cx, c) {
    try {
      const data = cx.getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < data.length; i += 64) {
        if (data[i] > 0) return false;
      }
      return true;
    } catch {
      return false; // can't tell — keep it
    }
  }

  // WebP q0.8 -> JPEG q0.85 -> PNG. toBlob silently substitutes PNG when a
  // type is unsupported (Safari/Firefox for WebP), so check blob.type.
  function encodeThumb(c) {
    return new Promise((resolve) => {
      c.toBlob(
        (w) => {
          if (w && w.type === "image/webp") return resolve(w);
          c.toBlob((j) => resolve(j || w || null), "image/jpeg", 0.85);
        },
        "image/webp",
        0.8
      );
    });
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
    state.doodlePalette.pencil.forEach((c, i) => {
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
    // header band: the prompt word + date in a rounded box above the drawing.
    // The output canvas GROWS by the band so it never overlaps the drawing.
    // All coordinates are CSS px under the dpr transform.
    const BAND = 72, PAD = 12, R = 14;
    const out = document.createElement("canvas");
    out.width = Math.round(rect.width * dpr);
    out.height = Math.round((rect.height + BAND) * dpr);
    const o = out.getContext("2d");
    o.setTransform(dpr, 0, 0, dpr, 0, 0);

    // page background
    o.fillStyle = state.doodlePalette.bg;
    o.fillRect(0, 0, rect.width, rect.height + BAND);

    // header box: accent-tinted fill + accent outline
    o.beginPath();
    o.roundRect(PAD, PAD, rect.width - 2 * PAD, BAND - 2 * PAD, R);
    o.save();
    o.globalAlpha = 0.16;
    o.fillStyle = state.doodlePalette.accent;
    o.fill();
    o.restore();
    o.lineWidth = 1.5;
    o.strokeStyle = state.doodlePalette.accent;
    o.stroke();

    // prompt word (big) + date (small, muted), centred in the box
    const FONTS = ' Eggi, ui-rounded, "Segoe UI", system-ui, sans-serif';
    o.fillStyle = state.doodlePalette.ink;
    o.textAlign = "center";
    o.font = "24px" + FONTS;
    o.fillText(state.promptWord || "doodle", rect.width / 2, PAD + 26);
    o.save();
    o.globalAlpha = 0.6;
    o.font = "12px" + FONTS;
    o.fillText(state.entry.date || "", rect.width / 2, BAND - PAD - 6);
    o.restore();

    // the drawing, below the band
    o.drawImage(canvas, 0, BAND, rect.width, rect.height);

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
    document.getElementById("toolGallery").addEventListener("click", async () => {
      if (!state.gallery) {
        const mod = await import("./galleryView.js");
        state.gallery = mod.createGalleryView(refs, state);
      }
      state.gallery.open();
    });

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
    archiveStale(); // bank past days into the gallery before any prune
    buildSwatches();
    color = state.doodlePalette.pencil[0];
    canvas.setAttribute("aria-hidden", "false");
    fitCanvas();
    restore(); // re-apply this day's saved doodle, if any
    setTool("pencil");
    refreshUndoBtn();
  }

  function deactivate() {
    if (state.gallery && state.gallery.isOpen()) state.gallery.close();
    canvas.style.pointerEvents = "none";
    canvas.setAttribute("aria-hidden", "true");
  }

  return { activate, deactivate };
}

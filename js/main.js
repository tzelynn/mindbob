// Entry point: load the current message, theme it, render the active mode,
// wire the mode menu + swipe navigation, and register the service worker.
import { getCurrentEntry } from "./messages.js";
import { MODES, isMode, nextMode, resolveSwipe } from "./modes.js";
import { paletteFor, doodlePaletteFor, applyPalette } from "./palette.js";
import { renderMessage, clearMessage } from "./messageDecorate.js";
import { registerSW } from "./pwa.js";
import { getCurrentPrompt } from "./prompts.js";
import { initNotifications } from "./notify.js";
import { getCurrentNuggets } from "./nuggets.js";

const refs = {
  app: document.getElementById("app"),
  stage: document.getElementById("stage"),
  canvas: document.getElementById("drawCanvas"),
  doodleLayer: document.getElementById("doodleLayer"),
  messageEl: document.getElementById("messageEl"),
  messageText: document.getElementById("messageText"),
  toolbar: document.getElementById("toolbar"),
  status: document.getElementById("status"),
  modeMenu: document.getElementById("modeMenu"),
  modeMenuBtn: document.getElementById("modeMenuBtn"),
  modeMenuList: document.getElementById("modeMenuList"),
  modeMenuLabel: document.getElementById("modeMenuLabel"),
  doodleWord: document.getElementById("doodleWord"),
  notifyBell: document.getElementById("notifyBell"),
  nuggetsEl: document.getElementById("nuggetsEl"),
  nuggetFact: document.getElementById("nuggetFact"),
  nuggetTrend: document.getElementById("nuggetTrend"),
  moodEl: document.getElementById("moodEl"),
  moodLog: document.getElementById("moodLog"),
  moodZoom: document.getElementById("moodZoom"),
  moodGrid: document.getElementById("moodGrid"),
  brainEl: document.getElementById("brainEl"),
  brainMonthly: document.getElementById("brainMonthly"),
  brainAdhoc: document.getElementById("brainAdhoc"),
  galleryOverlay: document.getElementById("galleryOverlay"),
  galleryClose: document.getElementById("galleryClose"),
  galleryBody: document.getElementById("galleryBody"),
};

const state = {
  entry: null,
  palette: null,
  doodlePalette: null, // doodle mode's own daily palette (decoupled from the note)
  mode: "message",
  promptWord: "",
  doodle: null, // lazily-loaded doodle controller
  gallery: null, // lazily-loaded gallery overlay controller
  nuggets: null, // current nuggets entry (fetched once, on first nuggets view)
  nuggetsMod: null, // lazily-loaded nuggets render module
  moodMod: null, // lazily-loaded mood render module
  brainMod: null, // lazily-loaded brain render module
};

async function init() {
  refs.app.classList.add("is-loading");

  state.entry = await getCurrentEntry();
  state.palette = paletteFor(state.entry.id);
  state.doodlePalette = doodlePaletteFor(state.entry.date);
  applyPalette(state.palette, refs.app);

  refs.messageText.textContent = state.entry.text;
  refs.status.textContent = statusLine(state.entry);

  state.promptWord = await getCurrentPrompt(state.entry.date);
  refs.doodleWord.textContent = state.promptWord;

  buildModeMenu(); // before the first setMode — setActiveTab touches the items

  const hashMode = location.hash.slice(1);
  await setMode(isMode(hashMode) ? hashMode : "message");
  refs.app.classList.remove("is-loading");

  initMenu();
  initSwipe(refs.stage);

  registerSW();
  initNotifications(refs.notifyBell, state);
}

// ---------- mode menu (single icon trigger + dropdown) ----------
function buildModeMenu() {
  refs.modeMenuList.innerHTML = "";
  for (const m of MODES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "mode-menu-item";
    b.setAttribute("role", "menuitemradio");
    b.setAttribute("aria-checked", "false");
    b.dataset.mode = m;
    b.textContent = m;
    b.addEventListener("click", () => {
      closeMenu();
      setMode(m);
    });
    refs.modeMenuList.appendChild(b);
  }
}

function openMenu() {
  refs.modeMenuList.hidden = false;
  refs.modeMenuBtn.setAttribute("aria-expanded", "true");
  const cur = refs.modeMenuList.querySelector('[aria-checked="true"]');
  (cur || refs.modeMenuList.firstElementChild)?.focus();
}

function closeMenu(refocus = false) {
  if (refs.modeMenuList.hidden) return;
  refs.modeMenuList.hidden = true;
  refs.modeMenuBtn.setAttribute("aria-expanded", "false");
  if (refocus) refs.modeMenuBtn.focus();
}

function initMenu() {
  refs.modeMenuBtn.addEventListener("click", () => {
    if (refs.modeMenuList.hidden) openMenu();
    else closeMenu();
  });
  document.addEventListener("pointerdown", (e) => {
    if (!refs.modeMenu.contains(e.target)) closeMenu();
  });
  refs.modeMenu.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeMenu(true);
      return;
    }
    if (refs.modeMenuList.hidden) return;
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...refs.modeMenuList.children];
    const i = items.indexOf(document.activeElement);
    const step = e.key === "ArrowDown" ? 1 : -1;
    items[(i + step + items.length) % items.length]?.focus();
  });
}

// ---------- swipe between modes ----------
function initSwipe(el) {
  let g = null; // active gesture: {id, x, y, dead}
  el.addEventListener("pointerdown", (e) => {
    // Strokes on the doodle canvas must never swipe — the canvas captures the
    // pointer and its events still bubble through the stage.
    if (!e.isPrimary || e.target === refs.canvas) return;
    g = { id: e.pointerId, x: e.clientX, y: e.clientY, dead: false };
  });
  el.addEventListener("pointermove", (e) => {
    if (!g || e.pointerId !== g.id || g.dead) return;
    const dy = Math.abs(e.clientY - g.y);
    // vertical intent = the user is scrolling; give the gesture up
    if (dy > 32 && dy > Math.abs(e.clientX - g.x)) g.dead = true;
  });
  el.addEventListener("pointerup", (e) => {
    if (!g || e.pointerId !== g.id) return;
    const dir = g.dead ? 0 : resolveSwipe(e.clientX - g.x, e.clientY - g.y);
    g = null;
    if (dir) {
      const next = nextMode(state.mode, dir);
      if (next) setMode(next); // fire-and-forget, same as menu clicks
    }
  });
  el.addEventListener("pointercancel", () => {
    g = null; // native scrolling claimed the gesture
  });
}

function statusLine(entry) {
  return entry.source === "builtin" ? "offline — saved note" : "today's note";
}

function setActiveTab(mode) {
  for (const item of refs.modeMenuList.querySelectorAll(".mode-menu-item")) {
    const active = item.dataset.mode === mode;
    item.classList.toggle("is-active", active);
    item.setAttribute("aria-checked", String(active));
  }
  refs.modeMenuLabel.textContent = mode;
}

async function setMode(mode) {
  state.mode = mode;
  refs.app.dataset.mode = mode;

  setActiveTab(mode);
  refs.toolbar.hidden = mode !== "doodle"; // toolbar belongs to doodle mode only

  // Doodle mode wears its own daily palette; message/nuggets wear the note's.
  applyPalette(mode === "doodle" ? state.doodlePalette : state.palette, refs.app);

  // Leave-state cleanup for the modes we're not entering.
  if (mode !== "doodle" && state.doodle) state.doodle.deactivate();
  if (mode !== "message") clearMessage(refs);
  if (mode !== "nuggets" && state.nuggetsMod) state.nuggetsMod.clearNuggets(refs);
  if (mode !== "mood" && state.moodMod) state.moodMod.clearMood(refs);
  if (mode !== "brain" && state.brainMod) state.brainMod.clearBrain(refs);

  if (mode === "message") {
    await renderMessage(refs, state.entry);
  } else if (mode === "doodle") {
    if (!state.doodle) {
      const mod = await import("./doodleDecorate.js");
      state.doodle = mod.createDoodleDecorator(refs, state);
    }
    state.doodle.activate();
  } else if (mode === "nuggets") {
    if (!state.nuggetsMod) state.nuggetsMod = await import("./nuggetsDecorate.js");
    if (!state.nuggets) state.nuggets = await getCurrentNuggets();
    state.nuggetsMod.renderNuggets(refs, state.nuggets);
  } else if (mode === "mood") {
    if (!state.moodMod) state.moodMod = await import("./moodDecorate.js");
    state.moodMod.renderMood(refs, state);
  } else if (mode === "brain") {
    if (!state.brainMod) state.brainMod = await import("./brainDecorate.js");
    state.brainMod.renderBrain(refs, state);
  }
}

init();

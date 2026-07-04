// Entry point: load the current message, theme it, render the active mode,
// wire the mode toggle, and register the service worker.
import { getCurrentEntry } from "./messages.js";
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
  modeMessage: document.getElementById("modeMessage"),
  modeDoodle: document.getElementById("modeDoodle"),
  modeNuggets: document.getElementById("modeNuggets"),
  modeMood: document.getElementById("modeMood"),
  doodleWord: document.getElementById("doodleWord"),
  notifyBell: document.getElementById("notifyBell"),
  nuggetsEl: document.getElementById("nuggetsEl"),
  nuggetFact: document.getElementById("nuggetFact"),
  nuggetTrend: document.getElementById("nuggetTrend"),
  moodEl: document.getElementById("moodEl"),
  moodLog: document.getElementById("moodLog"),
  moodZoom: document.getElementById("moodZoom"),
  moodGrid: document.getElementById("moodGrid"),
};

const state = {
  entry: null,
  palette: null,
  doodlePalette: null, // doodle mode's own daily palette (decoupled from the note)
  mode: "message",
  promptWord: "",
  doodle: null, // lazily-loaded doodle controller
  nuggets: null, // current nuggets entry (fetched once, on first nuggets view)
  nuggetsMod: null, // lazily-loaded nuggets render module
  moodMod: null, // lazily-loaded mood render module
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

  const startMode =
    location.hash === "#doodle"
      ? "doodle"
      : location.hash === "#nuggets"
      ? "nuggets"
      : location.hash === "#mood"
      ? "mood"
      : "message";
  await setMode(startMode);
  refs.app.classList.remove("is-loading");

  refs.modeMessage.addEventListener("click", () => setMode("message"));
  refs.modeDoodle.addEventListener("click", () => setMode("doodle"));
  refs.modeNuggets.addEventListener("click", () => setMode("nuggets"));
  refs.modeMood.addEventListener("click", () => setMode("mood"));

  registerSW();
  initNotifications(refs.notifyBell, state);
}

function statusLine(entry) {
  return entry.source === "builtin" ? "offline — saved note" : "today's note";
}

function setActiveTab(mode) {
  const tabs = {
    message: refs.modeMessage,
    doodle: refs.modeDoodle,
    nuggets: refs.modeNuggets,
    mood: refs.modeMood,
  };
  for (const [m, btn] of Object.entries(tabs)) {
    const active = m === mode;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", String(active));
  }
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
  }
}

init();

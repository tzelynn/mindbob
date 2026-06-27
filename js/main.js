// Entry point: load the current message, theme it, render the active mode,
// wire the mode toggle, and register the service worker.
import { getCurrentEntry } from "./messages.js";
import { paletteFor, applyPalette } from "./palette.js";
import { renderAuto, clearAuto } from "./autoDecorate.js";
import { registerSW } from "./pwa.js";
import { promptFor } from "./prompts.js";

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

const state = {
  entry: null,
  palette: null,
  mode: "auto",
  promptWord: "",
  doodle: null, // lazily-loaded doodle controller
};

async function init() {
  refs.app.classList.add("is-loading");

  state.entry = await getCurrentEntry();
  state.palette = paletteFor(state.entry.id);
  applyPalette(state.palette, refs.app);

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
}

function statusLine(entry) {
  const when = entry.slot === "pm" ? "evening note" : "morning note";
  return entry.source === "builtin" ? "offline — saved note" : when;
}

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

init();

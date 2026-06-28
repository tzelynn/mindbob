// Entry point: load the current message, theme it, render the active mode,
// wire the mode toggle, and register the service worker.
import { getCurrentEntry } from "./messages.js";
import { paletteFor, applyPalette } from "./palette.js";
import { renderMessage, clearMessage } from "./messageDecorate.js";
import { registerSW } from "./pwa.js";
import { getCurrentPrompt } from "./prompts.js";

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
  doodleWord: document.getElementById("doodleWord"),
};

const state = {
  entry: null,
  palette: null,
  mode: "message",
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

  state.promptWord = await getCurrentPrompt(state.entry.date);
  refs.doodleWord.textContent = state.promptWord;

  const startMode = location.hash === "#doodle" ? "doodle" : "message";
  await setMode(startMode);
  refs.app.classList.remove("is-loading");

  refs.modeMessage.addEventListener("click", () => setMode("message"));
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

  const isMessage = mode === "message";
  refs.modeMessage.classList.toggle("is-active", isMessage);
  refs.modeDoodle.classList.toggle("is-active", !isMessage);
  refs.modeMessage.setAttribute("aria-selected", String(isMessage));
  refs.modeDoodle.setAttribute("aria-selected", String(!isMessage));
  refs.toolbar.hidden = isMessage;

  if (isMessage) {
    if (state.doodle) state.doodle.deactivate();
    await renderMessage(refs, state.entry);
  } else {
    clearMessage(refs);
    if (!state.doodle) {
      const mod = await import("./doodleDecorate.js");
      state.doodle = mod.createDoodleDecorator(refs, state);
    }
    state.doodle.activate();
  }
}

init();

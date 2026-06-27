// Entry point: load the current message, theme it, render the active mode,
// wire the mode toggle, and register the service worker.
import { getCurrentEntry } from "./messages.js";
import { paletteFor, applyPalette } from "./palette.js";
import { renderAuto, clearAuto } from "./autoDecorate.js";
import { registerSW } from "./pwa.js";

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
  modeCustom: document.getElementById("modeCustom"),
};

const state = {
  entry: null,
  palette: null,
  mode: "auto",
  custom: null, // lazily-loaded custom-decorate controller
};

async function init() {
  refs.app.classList.add("is-loading");

  state.entry = await getCurrentEntry();
  state.palette = paletteFor(state.entry.id);
  applyPalette(state.palette, refs.app);

  refs.messageText.textContent = state.entry.text;
  refs.status.textContent = statusLine(state.entry);

  const startMode = location.hash === "#decorate" ? "custom" : "auto";
  await setMode(startMode);
  refs.app.classList.remove("is-loading");

  refs.modeAuto.addEventListener("click", () => setMode("auto"));
  refs.modeCustom.addEventListener("click", () => setMode("custom"));

  registerSW();
}

function statusLine(entry) {
  const when = entry.slot === "pm" ? "evening note" : "morning note";
  return entry.source === "builtin" ? "offline — saved note" : when;
}

async function setMode(mode) {
  if (mode === state.mode && (mode === "auto" ? true : state.custom)) {
    // still update toggle UI on first call
  }
  state.mode = mode;
  refs.app.dataset.mode = mode;

  const isAuto = mode === "auto";
  refs.modeAuto.classList.toggle("is-active", isAuto);
  refs.modeCustom.classList.toggle("is-active", !isAuto);
  refs.modeAuto.setAttribute("aria-selected", String(isAuto));
  refs.modeCustom.setAttribute("aria-selected", String(!isAuto));
  refs.toolbar.hidden = isAuto;

  if (isAuto) {
    if (state.custom) state.custom.deactivate();
    await renderAuto(refs, state.entry);
  } else {
    clearAuto(refs);
    if (!state.custom) {
      const mod = await import("./customDecorate.js");
      state.custom = mod.createCustomDecorator(refs, state);
    }
    state.custom.activate();
  }
}

init();

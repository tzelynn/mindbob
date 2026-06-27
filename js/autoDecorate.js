// AUTO mode: place the doodle + message in a calm, centred layout.
import { renderAutoDoodle } from "./doodles.js";

export async function renderAuto(refs, entry) {
  const { messageEl, doodleLayer } = refs;

  // Message sits centred (reset any drag transform from custom mode).
  messageEl.style.transform = "";
  messageEl.classList.remove("is-draggable", "is-dragging");

  doodleLayer.style.display = "";
  await renderAutoDoodle(doodleLayer, entry.id);
}

export function clearAuto(refs) {
  refs.doodleLayer.innerHTML = "";
  refs.doodleLayer.style.display = "none";
}

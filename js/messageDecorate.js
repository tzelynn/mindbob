// MESSAGE mode: place the doodle + message in a calm, centred layout.
import { renderMessageDoodle } from "./doodles.js";

export async function renderMessage(refs, entry) {
  const { messageEl, doodleLayer } = refs;

  // Message sits centred (reset any drag transform from custom mode).
  messageEl.style.transform = "";
  messageEl.classList.remove("is-draggable", "is-dragging");

  doodleLayer.style.display = "";
  await renderMessageDoodle(doodleLayer, entry.id);
}

export function clearMessage(refs) {
  refs.doodleLayer.innerHTML = "";
  refs.doodleLayer.style.display = "none";
}

// NUGGETS mode: fill the two cards (fun fact + tech trend). Lazy-imported by
// main.js on first entry into nuggets mode. Mirrors the render/clear shape of
// js/messageDecorate.js.

const SOURCE_CLASS = "nugget-source";

export function renderNuggets(refs, nuggets) {
  const { nuggetFact, nuggetTrend } = refs;

  nuggetFact.textContent = nuggets?.fact?.text || "";
  nuggetTrend.textContent = nuggets?.trend?.text || "";

  // Optional "source" link under the tech-trend card. Re-render cleanly: drop
  // any previous link first, then add one only when the trend has a real link.
  const card = nuggetTrend.parentElement;
  const existing = card.querySelector("." + SOURCE_CLASS);
  if (existing) existing.remove();

  const link = nuggets?.trend?.link;
  if (link) {
    const a = document.createElement("a");
    a.className = SOURCE_CLASS;
    a.href = link;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = "source";
    card.appendChild(a);
  }
}

export function clearNuggets(refs) {
  refs.nuggetFact.textContent = "";
  refs.nuggetTrend.textContent = "";
  const card = refs.nuggetTrend.parentElement;
  const existing = card.querySelector("." + SOURCE_CLASS);
  if (existing) existing.remove();
}

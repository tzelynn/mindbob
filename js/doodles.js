// Loads the doodle manifest and picks one deterministically per message.
// Doodles are inline SVG line-art using currentColor, so they pick up the
// palette accent and stay tiny + crisp.
import { hashString, seededRng } from "./util.js";

let manifestCache = null;

export async function loadManifest() {
  if (manifestCache) return manifestCache;
  try {
    const res = await fetch("./doodles/index.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("manifest " + res.status);
    manifestCache = await res.json();
  } catch {
    manifestCache = [];
  }
  return manifestCache;
}

export function doodleNameFor(seed, manifest) {
  if (!manifest || manifest.length === 0) return null;
  return manifest[hashString("doodle|" + seed) % manifest.length];
}

// Fetch an SVG file and return its markup (so it can be inlined).
export async function fetchDoodleSvg(name) {
  try {
    const res = await fetch("./doodles/" + name, { cache: "force-cache" });
    if (!res.ok) throw new Error("doodle " + res.status);
    return await res.text();
  } catch {
    return null;
  }
}

// Render the chosen doodle into a container with a little seeded variation
// (gentle offset + rotation) so the layout feels organic but stable.
export async function renderAutoDoodle(container, seed) {
  const manifest = await loadManifest();
  const name = doodleNameFor(seed, manifest);
  container.innerHTML = "";
  container.setAttribute("aria-hidden", "true");
  if (!name) return;

  const svg = await fetchDoodleSvg(name);
  if (!svg) return;
  container.innerHTML = svg;

  const r = seededRng(seed + "|placement");
  const dx = Math.round((r() - 0.5) * 16);     // -8..8 vw-ish
  const dy = 22 + Math.round(r() * 14);         // sit a bit below centre
  const rot = Math.round((r() - 0.5) * 16);     // -8..8 deg
  const el = container.firstElementChild;
  if (el) {
    el.style.transform = `translate(${dx}vw, ${dy}vh) rotate(${rot}deg)`;
    el.style.transition = "transform 600ms ease";
  }
}

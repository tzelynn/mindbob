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

// How many doodles to show for this note: 1..4, deterministic per seed and
// never more than the manifest can supply distinctly.
export function doodleCountFor(seed, manifest) {
  if (!manifest || manifest.length === 0) return 0;
  const max = Math.min(4, manifest.length);
  return 1 + (hashString("count|" + seed) % max);
}

// Pick `count` distinct doodles deterministically. Each pick is seeded
// independently (varied), then linear-probes past collisions so the set is
// always distinct (count is already capped to manifest length by the caller).
export function doodleNamesFor(seed, manifest, count) {
  if (!manifest || manifest.length === 0) return [];
  const n = Math.min(count, manifest.length);
  const used = new Set();
  const chosen = [];
  for (let i = 0; i < n; i++) {
    let idx = hashString("doodle|" + i + "|" + seed) % manifest.length;
    while (used.has(idx)) idx = (idx + 1) % manifest.length;
    used.add(idx);
    chosen.push(manifest[idx]);
  }
  return chosen;
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

// Symmetric / equally-spaced layouts keyed by doodle count. Each entry is a
// list of [x%, y%] anchor points; a doodle is centred on its point. Points sit
// in the top/bottom margins so they frame the centred message instead of
// clobbering it, and each layout is left-right (and where possible top-bottom)
// symmetric. Doodles shrink as the count grows so they never collide.
const LAYOUTS = {
  1: { size: "min(46vw, 230px)", points: [[50, 72]] },
  2: { size: "min(34vw, 170px)", points: [[50, 22], [50, 78]] },
  3: { size: "min(28vw, 140px)", points: [[50, 20], [27, 80], [73, 80]] },
  4: { size: "min(24vw, 120px)", points: [[25, 22], [75, 22], [25, 78], [75, 78]] },
};

// Render 1..4 chosen doodles into a container, each anchored to its symmetric
// layout point with a little seeded rotation so the layout feels organic but
// stable (same note -> identical placement).
export async function renderAutoDoodle(container, seed) {
  const manifest = await loadManifest();
  container.innerHTML = "";
  container.setAttribute("aria-hidden", "true");

  const count = doodleCountFor(seed, manifest);
  if (count === 0) return;

  const layout = LAYOUTS[count];
  const names = doodleNamesFor(seed, manifest, count);
  const svgs = await Promise.all(names.map(fetchDoodleSvg));

  const r = seededRng(seed + "|placement");
  svgs.forEach((svg, i) => {
    if (!svg) return;
    const [x, y] = layout.points[i];
    const rot = Math.round((r() - 0.5) * 16);   // -8..8 deg

    const slot = document.createElement("div");
    slot.className = "doodle-slot";
    slot.innerHTML = svg;
    slot.style.left = x + "%";
    slot.style.top = y + "%";
    slot.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`;
    slot.style.transition = "transform 600ms ease";

    const el = slot.firstElementChild;
    if (el) el.style.width = layout.size;

    container.appendChild(slot);
  });
}

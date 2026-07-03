// Curated calming palettes. Each message gets one cohesive palette,
// chosen deterministically from its id, so AM != PM and every message
// has its own matching pencil colours (spec requirement).
import { hashString } from "./util.js";

export const PALETTES = [
  {
    name: "sand",
    bg: "#f4efe6", ink: "#4a4034", accent: "#c9a36a",
    pencil: ["#c9a36a", "#7d9b76", "#d98c7a", "#6c7a99", "#4a4034"],
  },
  {
    name: "sage",
    bg: "#eef1ea", ink: "#3c463b", accent: "#8aa37b",
    pencil: ["#8aa37b", "#d6a96a", "#7a92a8", "#cf8a86", "#3c463b"],
  },
  {
    name: "mist",
    bg: "#eef1f4", ink: "#384149", accent: "#7d9cb0",
    pencil: ["#7d9cb0", "#a7b89a", "#e0a989", "#9888ab", "#384149"],
  },
  {
    name: "blush",
    bg: "#f6edea", ink: "#4d3b39", accent: "#d39187",
    pencil: ["#d39187", "#c9a36a", "#8aa37b", "#8090ab", "#4d3b39"],
  },
  {
    name: "lavender",
    bg: "#f0edf4", ink: "#42394d", accent: "#9c8bb5",
    pencil: ["#9c8bb5", "#d6a96a", "#85a8a0", "#cf8a9a", "#42394d"],
  },
  {
    name: "dusk",
    bg: "#e9e8ee", ink: "#373445", accent: "#6f6b94",
    pencil: ["#6f6b94", "#b08fa6", "#7f9aa6", "#c2a06a", "#373445"],
  },
  {
    name: "clay",
    bg: "#f3ece6", ink: "#473b32", accent: "#bb7d5f",
    pencil: ["#bb7d5f", "#7d9b76", "#6c7a99", "#caa55f", "#473b32"],
  },
  {
    name: "sea",
    bg: "#e9f0ee", ink: "#33433f", accent: "#6fa193",
    pencil: ["#6fa193", "#d6a96a", "#7a8fb0", "#cf8a86", "#33433f"],
  },
];

export function paletteFor(seed) {
  return PALETTES[hashString("palette|" + seed) % PALETTES.length];
}

// Doodle mode gets its OWN cohesive palette that changes each day, seeded from
// the date (a distinct namespace from paletteFor) so it varies day to day and
// is decoupled from the message's palette — while staying deterministic within
// a day so a persisted drawing keeps its colours across reloads.
export function doodlePaletteFor(dateSeed) {
  return PALETTES[hashString("doodle-palette|" + dateSeed) % PALETTES.length];
}

// Apply a palette to the app element via CSS custom properties.
export function applyPalette(palette, el = document.querySelector(".app")) {
  el.style.setProperty("--bg", palette.bg);
  el.style.setProperty("--ink", palette.ink);
  el.style.setProperty("--accent", palette.accent);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", palette.bg);
}

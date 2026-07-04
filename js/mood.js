// MOOD tracker: per-day mood on a 1-5 scale, stored in localStorage (one key
// per day, no backend). This module is DOM-free — storage + pure calendar
// helpers only, so it's unit-testable. Rendering lives in js/moodDecorate.js.

const STORE_PREFIX = "mindbob:mood:";
// Keep history bounded but generous enough for the year view. ~35 bytes/day, so
// even the full window is a few tens of KB.
const MAX_AGE_DAYS = 730;

// 1..5, low -> high. Each level is a muted colour + a line-art weather glyph in
// the same style as doodles/*.svg (viewBox 0 0 100 100, stroke="currentColor").
export const MOOD_LEVELS = [1, 2, 3, 4, 5];

export const MOOD_LABELS = ["rough", "low", "okay", "good", "great"];

// Muted low->high ramp: terracotta -> clay -> sand -> sage -> green. Chosen to
// sit calmly on the warm-paper theme while still reading as a semantic gradient.
export const MOOD_COLORS = [
  "#b5695e", // 1 rough  — muted terracotta
  "#cf9a7f", // 2 low    — soft clay
  "#cbb88f", // 3 okay   — sand / neutral
  "#9db183", // 4 good   — sage
  "#6f9e78", // 5 great  — muted green
];

// Full inline <svg> strings (index 0 = level 1). currentColor lets the button's
// `color` tint them; no width/height so CSS controls the size.
const SVG_OPEN =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" ' +
  'stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">';

export const MOOD_GLYPHS = [
  // 1 rough — storm cloud with a lightning bolt
  SVG_OPEN +
    '<path d="M30 54 a14 14 0 0 1 2 -27 a18 18 0 0 1 34 -3 a13 13 0 0 1 4 30 Z" />' +
    '<path d="M52 58 L44 72 H53 L46 88" />' +
    "</svg>",
  // 2 low — overcast cloud with light rain
  SVG_OPEN +
    '<path d="M28 60 a14 14 0 0 1 2 -27 a18 18 0 0 1 34 -3 a13 13 0 0 1 4 30 Z" />' +
    '<path d="M36 74 l-3 8 M52 74 l-3 8 M68 74 l-3 8" />' +
    "</svg>",
  // 3 okay — calm water (three gentle waves)
  SVG_OPEN +
    '<path d="M12 40 q12 -14 24 0 t24 0 t24 0" />' +
    '<path d="M12 56 q12 -14 24 0 t24 0 t24 0" />' +
    '<path d="M12 72 q12 -14 24 0 t24 0 t24 0" />' +
    "</svg>",
  // 4 good — sun peeking from behind a cloud
  SVG_OPEN +
    '<circle cx="60" cy="40" r="13" />' +
    '<path d="M60 18 V25 M82 40 H89 M75 25 l5 -5 M45 25 l4 4" />' +
    '<path d="M24 76 a12 12 0 0 1 2 -23 a15 15 0 0 1 29 -3 a11 11 0 0 1 3 26 Z" />' +
    "</svg>",
  // 5 great — bright sun
  SVG_OPEN +
    '<circle cx="50" cy="50" r="18" />' +
    '<path d="M50 14 V24 M50 76 V86 M14 50 H24 M76 50 H86 M25 25 l7 7 M68 68 l7 7 M75 25 l-7 7 M32 68 l-7 7" />' +
    "</svg>",
];

// ---------- date helpers (local time, YYYY-MM-DD) ----------
function pad(n) {
  return String(n).padStart(2, "0");
}

// Format a Date as a local YYYY-MM-DD key. Local (not UTC) so a mood is filed
// under the user's calendar day; string shape sorts lexicographically.
export function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayKey() {
  return dateKey(new Date());
}

// Parse a YYYY-MM-DD key back into a local Date (midnight).
export function keyToDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

// Monday-based weekday index: Mon=0 .. Sun=6.
function mondayIndex(date) {
  return (date.getDay() + 6) % 7;
}

export function isFuture(date, today = new Date()) {
  return dateKey(date) > dateKey(today);
}

// ---------- pure calendar layouts ----------
// weeks x 7 grid of (Date|null); Monday-start, leading/trailing null padding.
export function monthMatrix(year, monthIndex) {
  const total = daysInMonth(year, monthIndex);
  const lead = mondayIndex(new Date(year, monthIndex, 1));
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(new Date(year, monthIndex, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// The 7 dates (Mon..Sun) of the week containing `date`.
export function weekDays(date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - mondayIndex(date));
  return Array.from({ length: 7 }, (_, i) =>
    new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)
  );
}

// 12 months, each { monthIndex, days: Date[] } — the classic year-in-pixels.
export function yearMatrix(year) {
  return Array.from({ length: 12 }, (_, m) => ({
    monthIndex: m,
    days: Array.from({ length: daysInMonth(year, m) }, (_, i) => new Date(year, m, i + 1)),
  }));
}

// ---------- value helpers ----------
// Coerce to a valid level 1..5, else null (used to un-set a day).
export function clampLevel(n) {
  const v = Math.round(Number(n));
  return Number.isInteger(v) && v >= 1 && v <= 5 ? v : null;
}

// ---------- storage (all try/catch — degrade silently when unavailable) ----------
function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function readMood(key) {
  const ls = storage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(STORE_PREFIX + key);
    if (!raw) return null;
    return clampLevel(JSON.parse(raw).mood);
  } catch {
    return null;
  }
}

// Set (or, for an invalid level, clear) a day's mood, then prune stale keys.
export function writeMood(key, level) {
  const ls = storage();
  if (!ls) return;
  const lvl = clampLevel(level);
  try {
    if (lvl === null) ls.removeItem(STORE_PREFIX + key);
    else ls.setItem(STORE_PREFIX + key, JSON.stringify({ mood: lvl }));
    pruneOld(ls);
  } catch {
    // disabled/full — degrade to whatever is already stored
  }
}

// Drop mood keys older than MAX_AGE_DAYS so storage stays bounded (history for
// the year view is preserved; only long-past days are shed).
function pruneOld(ls) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_AGE_DAYS);
  const cutoffKey = dateKey(cutoff);
  for (let i = ls.length - 1; i >= 0; i--) {
    const k = ls.key(i);
    if (k && k.startsWith(STORE_PREFIX) && k.slice(STORE_PREFIX.length) < cutoffKey) {
      ls.removeItem(k);
    }
  }
}

// Map<"YYYY-MM-DD", 1..5> of every stored mood. Parsed defensively so one
// corrupt entry can't break the whole history render.
export function readAllMoods() {
  const out = new Map();
  const ls = storage();
  if (!ls) return out;
  try {
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (!k || !k.startsWith(STORE_PREFIX)) continue;
      try {
        const lvl = clampLevel(JSON.parse(ls.getItem(k)).mood);
        if (lvl !== null) out.set(k.slice(STORE_PREFIX.length), lvl);
      } catch {
        // skip corrupt entry
      }
    }
  } catch {
    // storage iteration failed — return whatever we have
  }
  return out;
}

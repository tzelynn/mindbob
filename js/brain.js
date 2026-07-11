// BRAIN dump: a to-do tab with two sections, both stored in localStorage (no
// backend). This module is DOM-free — storage + pure helpers only, so it's
// unit-testable. Rendering lives in js/brainDecorate.js.
//
// - Monthly: recurring task *definitions* persist across months; only the set
//   of tasks checked *this* month resets (automatically, on the 1st).
// - Ad-hoc: a flat list of notes/to-dos, removed once done.

const MONTHLY_KEY = "mindbob:brain:monthly";
const ADHOC_KEY = "mindbob:brain:adhoc";

// ---------- helpers ----------
function pad(n) {
  return String(n).padStart(2, "0");
}

// Local (not UTC) calendar-month key, YYYY-MM. Sorts lexicographically and
// changes exactly when the user's month rolls over.
export function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

// A stable-enough unique id for a list item. crypto.randomUUID where available
// (browsers + Node 19+), else a time+counter fallback.
let uidCounter = 0;
export function uid() {
  try {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  uidCounter += 1;
  return `${Date.now().toString(36)}-${uidCounter.toString(36)}`;
}

// ---------- storage (all try/catch — degrade silently when unavailable) ----------
function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function readJSON(ls, key, fallback) {
  try {
    const raw = ls.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJSON(ls, key, value) {
  try {
    ls.setItem(key, JSON.stringify(value));
  } catch {
    // disabled/full — degrade to in-memory (i.e. lost on reload)
  }
}

// ---------- monthly section ----------
// Returns { tasks: [{id,text}], done: [id,...] } normalized to the current
// month. If the stored month is stale, the done set is cleared (definitions
// kept) and the reset is persisted. `done` is filtered to ids that still exist.
export function readMonthly(now = new Date()) {
  const ls = storage();
  if (!ls) return { tasks: [], done: [] };

  const stored = readJSON(ls, MONTHLY_KEY, null);
  const tasks = Array.isArray(stored?.tasks)
    ? stored.tasks.filter((t) => t && typeof t.id === "string" && typeof t.text === "string")
    : [];
  const ids = new Set(tasks.map((t) => t.id));

  const current = monthKey(now);
  const monthChanged = !stored || stored.month !== current;
  let done = monthChanged
    ? []
    : (Array.isArray(stored.done) ? stored.done.filter((id) => ids.has(id)) : []);

  // Persist the normalized shape (month reset and/or stale-id pruning) so the
  // stored value stays consistent with what callers see.
  writeJSON(ls, MONTHLY_KEY, { tasks, month: current, done });
  return { tasks, done };
}

export function addMonthlyTask(text, now = new Date()) {
  const clean = String(text ?? "").trim();
  if (!clean) return readMonthly(now);
  const ls = storage();
  if (!ls) return { tasks: [], done: [] };
  const { tasks, done } = readMonthly(now);
  tasks.push({ id: uid(), text: clean });
  writeJSON(ls, MONTHLY_KEY, { tasks, month: monthKey(now), done });
  return { tasks, done };
}

export function removeMonthlyTask(id, now = new Date()) {
  const ls = storage();
  if (!ls) return { tasks: [], done: [] };
  const { tasks, done } = readMonthly(now);
  const nextTasks = tasks.filter((t) => t.id !== id);
  const nextDone = done.filter((d) => d !== id);
  writeJSON(ls, MONTHLY_KEY, { tasks: nextTasks, month: monthKey(now), done: nextDone });
  return { tasks: nextTasks, done: nextDone };
}

// Toggle whether a task is checked off this month.
export function toggleMonthlyDone(id, now = new Date()) {
  const ls = storage();
  if (!ls) return { tasks: [], done: [] };
  const { tasks, done } = readMonthly(now);
  if (!tasks.some((t) => t.id === id)) return { tasks, done };
  const nextDone = done.includes(id) ? done.filter((d) => d !== id) : [...done, id];
  writeJSON(ls, MONTHLY_KEY, { tasks, month: monthKey(now), done: nextDone });
  return { tasks, done: nextDone };
}

// ---------- ad-hoc section ----------
export function readAdhoc() {
  const ls = storage();
  if (!ls) return [];
  const stored = readJSON(ls, ADHOC_KEY, []);
  return Array.isArray(stored)
    ? stored.filter((t) => t && typeof t.id === "string" && typeof t.text === "string")
    : [];
}

export function addAdhoc(text) {
  const clean = String(text ?? "").trim();
  if (!clean) return readAdhoc();
  const ls = storage();
  if (!ls) return [];
  const items = readAdhoc();
  items.push({ id: uid(), text: clean });
  writeJSON(ls, ADHOC_KEY, items);
  return items;
}

export function removeAdhoc(id) {
  const ls = storage();
  if (!ls) return [];
  const items = readAdhoc().filter((t) => t.id !== id);
  writeJSON(ls, ADHOC_KEY, items);
  return items;
}

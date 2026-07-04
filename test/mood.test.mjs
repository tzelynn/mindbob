import { test } from "node:test";
import assert from "node:assert/strict";

// Minimal in-memory localStorage stub, installed before importing mood.js.
// mood.js reads globalThis.localStorage lazily (inside functions), so setting it
// here — after the hoisted imports resolve but before any test runs — is enough.
function makeStorage() {
  const map = new Map();
  return {
    get length() { return map.size; },
    key(i) { return [...map.keys()][i] ?? null; },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    clear() { map.clear(); },
    _map: map,
  };
}
globalThis.localStorage = makeStorage();

const {
  clampLevel,
  dateKey,
  todayKey,
  keyToDate,
  daysInMonth,
  monthMatrix,
  weekDays,
  yearMatrix,
  isFuture,
  readMood,
  writeMood,
  readAllMoods,
} = await import("../js/mood.js");

const PREFIX = "mindbob:mood:";
function reset() { globalThis.localStorage.clear(); }

// ---------- pure value helpers ----------
test("clampLevel accepts 1..5, rejects the rest", () => {
  assert.equal(clampLevel(1), 1);
  assert.equal(clampLevel(5), 5);
  assert.equal(clampLevel(3.4), 3); // rounds
  assert.equal(clampLevel(0), null);
  assert.equal(clampLevel(6), null);
  assert.equal(clampLevel("x"), null);
  assert.equal(clampLevel(null), null);
});

// ---------- date formatting ----------
test("dateKey is zero-padded local YYYY-MM-DD", () => {
  assert.equal(dateKey(new Date(2026, 0, 3)), "2026-01-03");
  assert.equal(dateKey(new Date(2026, 11, 25)), "2026-12-25");
});

test("keyToDate round-trips dateKey", () => {
  const d = new Date(2026, 6, 4);
  assert.equal(dateKey(keyToDate(dateKey(d))), "2026-07-04");
});

test("todayKey matches dateKey(now)", () => {
  assert.equal(todayKey(), dateKey(new Date()));
});

test("daysInMonth handles leap February", () => {
  assert.equal(daysInMonth(2024, 1), 29);
  assert.equal(daysInMonth(2026, 1), 28);
  assert.equal(daysInMonth(2026, 6), 31);
});

// ---------- calendar layouts ----------
test("monthMatrix: Monday-start, correct padding and day placement", () => {
  // July 2026: the 1st is a Wednesday -> Monday-index 2 leading nulls.
  const weeks = monthMatrix(2026, 6);
  const flat = weeks.flat();
  assert.equal(flat.length % 7, 0);
  assert.equal(flat[0], null);
  assert.equal(flat[1], null);
  assert.equal(flat[2].getDate(), 1); // first real cell is the 1st
  const realDays = flat.filter(Boolean);
  assert.equal(realDays.length, 31);
  assert.equal(realDays[30].getDate(), 31);
});

test("weekDays returns 7 consecutive dates starting Monday", () => {
  const days = weekDays(new Date(2026, 6, 4)); // Sat 4 Jul 2026
  assert.equal(days.length, 7);
  assert.equal(days[0].getDay(), 1); // Monday
  assert.equal(days[6].getDay(), 0); // Sunday
  assert.equal(dateKey(days[0]), "2026-06-29");
  assert.equal(dateKey(days[6]), "2026-07-05");
});

test("yearMatrix has 12 months with correct day counts", () => {
  const y = yearMatrix(2024); // leap year
  assert.equal(y.length, 12);
  assert.equal(y[1].days.length, 29); // Feb 2024
  assert.equal(y[0].days.length, 31); // Jan
  assert.equal(y[3].days.length, 30); // Apr
});

test("isFuture compares by calendar day", () => {
  const today = new Date(2026, 6, 4);
  assert.equal(isFuture(new Date(2026, 6, 5), today), true);
  assert.equal(isFuture(new Date(2026, 6, 4), today), false); // same day
  assert.equal(isFuture(new Date(2026, 6, 3), today), false);
});

// ---------- storage ----------
test("writeMood -> readMood round-trips", () => {
  reset();
  writeMood("2026-07-01", 4);
  assert.equal(readMood("2026-07-01"), 4);
  assert.equal(globalThis.localStorage.getItem(PREFIX + "2026-07-01"), '{"mood":4}');
});

test("writeMood with an invalid level clears the day", () => {
  reset();
  writeMood("2026-07-01", 3);
  writeMood("2026-07-01", null);
  assert.equal(readMood("2026-07-01"), null);
});

test("readAllMoods returns a Map of valid entries and skips corrupt ones", () => {
  reset();
  writeMood("2026-07-01", 2);
  writeMood("2026-07-02", 5);
  globalThis.localStorage.setItem(PREFIX + "2026-07-03", "not json");
  globalThis.localStorage.setItem("unrelated:key", "x");
  const all = readAllMoods();
  assert.equal(all.size, 2);
  assert.equal(all.get("2026-07-01"), 2);
  assert.equal(all.get("2026-07-02"), 5);
  assert.equal(all.has("2026-07-03"), false);
});

test("writeMood prunes entries older than ~2 years", () => {
  reset();
  const old = new Date();
  old.setDate(old.getDate() - 900); // > 730-day cap
  const oldKey = dateKey(old);
  globalThis.localStorage.setItem(PREFIX + oldKey, '{"mood":3}');
  writeMood(todayKey(), 4); // triggers prune
  assert.equal(readMood(oldKey), null);
  assert.equal(readMood(todayKey()), 4);
});

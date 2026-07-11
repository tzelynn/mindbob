import { test } from "node:test";
import assert from "node:assert/strict";

// Minimal in-memory localStorage stub, installed before importing brain.js.
// brain.js reads globalThis.localStorage lazily (inside functions), so setting
// it here — after the hoisted imports resolve but before any test runs — is enough.
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
  monthKey,
  uid,
  readMonthly,
  addMonthlyTask,
  removeMonthlyTask,
  toggleMonthlyDone,
  readAdhoc,
  addAdhoc,
  removeAdhoc,
} = await import("../js/brain.js");

const MONTHLY_KEY = "mindbob:brain:monthly";
function reset() { globalThis.localStorage.clear(); }

// ---------- helpers ----------
test("monthKey is zero-padded local YYYY-MM", () => {
  assert.equal(monthKey(new Date(2026, 0, 3)), "2026-01");
  assert.equal(monthKey(new Date(2026, 11, 25)), "2026-12");
});

test("uid returns distinct non-empty strings", () => {
  const a = uid();
  const b = uid();
  assert.equal(typeof a, "string");
  assert.ok(a.length > 0);
  assert.notEqual(a, b);
});

// ---------- monthly section ----------
test("addMonthlyTask -> readMonthly round-trips a definition", () => {
  reset();
  const now = new Date(2026, 6, 4);
  addMonthlyTask("pay rent", now);
  const { tasks, done } = readMonthly(now);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].text, "pay rent");
  assert.deepEqual(done, []);
});

test("addMonthlyTask trims and ignores empty text", () => {
  reset();
  const now = new Date(2026, 6, 4);
  addMonthlyTask("  water plants  ", now);
  addMonthlyTask("   ", now);
  const { tasks } = readMonthly(now);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].text, "water plants");
});

test("toggleMonthlyDone adds then removes the id from done", () => {
  reset();
  const now = new Date(2026, 6, 4);
  addMonthlyTask("call mum", now);
  const id = readMonthly(now).tasks[0].id;
  assert.deepEqual(toggleMonthlyDone(id, now).done, [id]);
  assert.deepEqual(toggleMonthlyDone(id, now).done, []);
});

test("toggleMonthlyDone ignores unknown ids", () => {
  reset();
  const now = new Date(2026, 6, 4);
  addMonthlyTask("stretch", now);
  assert.deepEqual(toggleMonthlyDone("nope", now).done, []);
});

test("removeMonthlyTask drops the definition and its done entry", () => {
  reset();
  const now = new Date(2026, 6, 4);
  addMonthlyTask("a", now);
  addMonthlyTask("b", now);
  const [t1, t2] = readMonthly(now).tasks;
  toggleMonthlyDone(t1.id, now);
  const { tasks, done } = removeMonthlyTask(t1.id, now);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].id, t2.id);
  assert.deepEqual(done, []);
});

test("monthly done resets when the stored month is stale; tasks persist", () => {
  reset();
  const july = new Date(2026, 6, 4);
  addMonthlyTask("recurring", july);
  const id = readMonthly(july).tasks[0].id;
  toggleMonthlyDone(id, july);
  // Now read from the next month — checks should clear, definition should stay.
  const august = new Date(2026, 7, 1);
  const { tasks, done } = readMonthly(august);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].text, "recurring");
  assert.deepEqual(done, []);
});

test("readMonthly filters done ids that no longer exist", () => {
  reset();
  const now = new Date(2026, 6, 4);
  // Seed a stored value with a done id that isn't in tasks.
  globalThis.localStorage.setItem(
    MONTHLY_KEY,
    JSON.stringify({ tasks: [{ id: "x", text: "real" }], month: monthKey(now), done: ["x", "ghost"] })
  );
  assert.deepEqual(readMonthly(now).done, ["x"]);
});

test("readMonthly tolerates corrupt storage", () => {
  reset();
  globalThis.localStorage.setItem(MONTHLY_KEY, "not json");
  const { tasks, done } = readMonthly(new Date(2026, 6, 4));
  assert.deepEqual(tasks, []);
  assert.deepEqual(done, []);
});

// ---------- ad-hoc section ----------
test("addAdhoc -> readAdhoc round-trips, remove drops the item", () => {
  reset();
  addAdhoc("buy milk");
  addAdhoc("look into rust");
  let items = readAdhoc();
  assert.equal(items.length, 2);
  assert.equal(items[0].text, "buy milk");
  items = removeAdhoc(items[0].id);
  assert.equal(items.length, 1);
  assert.equal(items[0].text, "look into rust");
});

test("addAdhoc trims and ignores empty text", () => {
  reset();
  addAdhoc("  ping alice  ");
  addAdhoc("   ");
  const items = readAdhoc();
  assert.equal(items.length, 1);
  assert.equal(items[0].text, "ping alice");
});

test("readAdhoc returns [] on corrupt storage", () => {
  reset();
  globalThis.localStorage.setItem("mindbob:brain:adhoc", "{bad");
  assert.deepEqual(readAdhoc(), []);
});

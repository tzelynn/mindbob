import { test } from "node:test";
import assert from "node:assert/strict";
import { pickCurrentEntry } from "../js/selectEntry.js";
import { selectCurrentNuggets } from "../js/nuggets.js";

// One nuggets entry per day, published at 00:00 UTC (see the generator).
const nugget = (date, fact) => ({
  id: date,
  date,
  publishAt: `${date}T00:00:00Z`,
  fact: { text: fact, source: "api" },
  trend: { text: "trend", source: "llm" },
});

const sat = nugget("2026-06-27", "saturday fact");
const sun = nugget("2026-06-28", "sunday fact");
const mon = nugget("2026-06-29", "monday fact");

const ms = (iso) => new Date(iso).getTime();

test("picks the newest entry already published", () => {
  const chosen = pickCurrentEntry([sat, sun, mon], ms("2026-06-28T12:00:00Z"));
  assert.equal(chosen.id, "2026-06-28");
});

test("ignores future entries", () => {
  const chosen = pickCurrentEntry([sat, sun, mon], ms("2026-06-27T05:00:00Z"));
  assert.equal(chosen.id, "2026-06-27");
});

test("returns null when nothing is published yet", () => {
  const chosen = pickCurrentEntry([sun, mon], ms("2026-06-27T00:00:00Z"));
  assert.equal(chosen, null);
});

test("selectCurrentNuggets falls back to the oldest entry when all are in the future", () => {
  const data = { entries: [mon, sun] };
  const chosen = selectCurrentNuggets(data, new Date("2026-06-27T00:00:00Z"));
  assert.equal(chosen.id, "2026-06-28"); // oldest by publishAt
});

test("selectCurrentNuggets picks the current published entry when one exists", () => {
  const data = { entries: [sat, sun, mon] };
  const chosen = selectCurrentNuggets(data, new Date("2026-06-28T12:00:00Z"));
  assert.equal(chosen.id, "2026-06-28");
});

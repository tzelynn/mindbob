import { test } from "node:test";
import assert from "node:assert/strict";
import { pickCurrentEntry } from "../js/selectEntry.js";
import { selectCurrent } from "../js/messages.js";

const am = { id: "2026-06-28-am", slot: "am", publishAt: "2026-06-28T00:00:00Z", text: "morning" };
const pm = { id: "2026-06-28-pm", slot: "pm", publishAt: "2026-06-28T11:00:00Z", text: "evening" };
const tomorrowAm = { id: "2026-06-29-am", slot: "am", publishAt: "2026-06-29T00:00:00Z", text: "next" };

const ms = (iso) => new Date(iso).getTime();

test("picks the newest entry already published", () => {
  const chosen = pickCurrentEntry([am, pm, tomorrowAm], ms("2026-06-28T12:00:00Z"));
  assert.equal(chosen.id, "2026-06-28-pm");
});

test("ignores future entries", () => {
  const chosen = pickCurrentEntry([am, pm, tomorrowAm], ms("2026-06-28T05:00:00Z"));
  assert.equal(chosen.id, "2026-06-28-am");
});

test("returns null when nothing is published yet", () => {
  const chosen = pickCurrentEntry([am, pm], ms("2026-06-27T00:00:00Z"));
  assert.equal(chosen, null);
});

test("selectCurrent falls back to the oldest entry when all are in the future", () => {
  const data = { entries: [pm, am] };
  const chosen = selectCurrent(data, new Date("2026-06-27T00:00:00Z"));
  assert.equal(chosen.id, "2026-06-28-am"); // oldest by publishAt
});

test("selectCurrent picks the current published entry when one exists", () => {
  const data = { entries: [am, pm] };
  const chosen = selectCurrent(data, new Date("2026-06-28T12:00:00Z"));
  assert.equal(chosen.id, "2026-06-28-pm");
});

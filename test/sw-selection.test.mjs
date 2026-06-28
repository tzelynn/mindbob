import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pickCurrentEntry } from "../js/selectEntry.js";

// Extract the SW's duplicated pickCurrentEntry between the marker comments and
// build a callable function from it — no SW globals are referenced inside it.
async function loadSwPick() {
  const src = await readFile(new URL("../sw.js", import.meta.url), "utf8");
  const m = src.match(/\/\/ >>> selection-parity >>>([\s\S]*?)\/\/ <<< selection-parity <<</);
  assert.ok(m, "sw.js must contain the selection-parity marker block");
  const block = m[1];
  // The block defines `function pickCurrentEntry(...)`; return it.
  return new Function(block + "\nreturn pickCurrentEntry;")();
}

const entries = [
  { id: "a", publishAt: "2026-06-28T00:00:00Z" },
  { id: "b", publishAt: "2026-06-28T11:00:00Z" },
  { id: "c", publishAt: "2026-06-29T00:00:00Z" },
];
const cases = [
  "2026-06-27T00:00:00Z",
  "2026-06-28T05:00:00Z",
  "2026-06-28T12:00:00Z",
  "2026-06-29T06:00:00Z",
];

test("sw.js pickCurrentEntry matches js/selectEntry.js on all fixtures", async () => {
  const swPick = await loadSwPick();
  for (const iso of cases) {
    const ms = new Date(iso).getTime();
    const expected = pickCurrentEntry(entries, ms);
    const actual = swPick(entries, ms);
    assert.deepEqual(
      actual && actual.id,
      expected && expected.id,
      `mismatch at ${iso}`
    );
  }
});

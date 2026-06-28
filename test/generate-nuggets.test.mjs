import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanText,
  isGoodFact,
  isGoodTrend,
  pickFromBank,
  parseArxivTitles,
} from "../scripts/generate-nuggets.mjs";

test("cleanText strips wrapping quotes and collapses whitespace", () => {
  assert.equal(cleanText('  "hello   world"  '), "hello world");
  assert.equal(cleanText("“curly”"), "curly");
  assert.equal(cleanText(""), "");
  assert.equal(cleanText(null), "");
});

test("isGoodFact rejects empty, too-short, and duplicate facts", () => {
  assert.equal(isGoodFact("", []), false);
  assert.equal(isGoodFact("too short", []), false); // < 12 chars
  const fact = "Octopuses have three hearts, two stop when they swim.";
  assert.equal(isGoodFact(fact, []), true);
  assert.equal(isGoodFact(fact, [fact]), false); // dedupe
});

test("isGoodTrend rejects refusals and over-long output", () => {
  assert.equal(isGoodTrend("I cannot help with that.", []), false);
  assert.equal(isGoodTrend("AI agents are trending right now.", []), true);
  assert.equal(isGoodTrend("x".repeat(300), []), false); // > max
});

test("pickFromBank rotates deterministically by entry count", () => {
  const bank = ["a", "b", "c"];
  assert.equal(pickFromBank(bank, [], 0), "a");
  assert.equal(pickFromBank(bank, [], 1), "b");
  assert.equal(pickFromBank(bank, [], 3), "a"); // wraps
});

test("pickFromBank avoids recently-shown items when possible", () => {
  const bank = ["a", "b", "c"];
  // 'a' and 'b' already shown -> only 'c' remains in the pool
  assert.equal(pickFromBank(bank, ["a", "b"], 0), "c");
  assert.equal(pickFromBank(bank, ["a", "b"], 5), "c");
});

test("pickFromBank handles empty/missing banks", () => {
  assert.equal(pickFromBank([], [], 0), "");
  assert.equal(pickFromBank(undefined, [], 0), "");
});

test("parseArxivTitles extracts per-entry titles, skipping the feed title", () => {
  const xml = `<?xml version="1.0"?>
    <feed>
      <title>ArXiv Query Feed</title>
      <entry><title>Scaling Laws for   Tiny Models</title></entry>
      <entry><title>Agents that Plan</title></entry>
    </feed>`;
  assert.deepEqual(parseArxivTitles(xml), [
    "Scaling Laws for Tiny Models",
    "Agents that Plan",
  ]);
  assert.deepEqual(parseArxivTitles(""), []);
});

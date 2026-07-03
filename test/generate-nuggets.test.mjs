import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanText,
  isGoodFact,
  isGoodTrend,
  pickFromBank,
  parseArxivEntries,
  scoreCandidate,
  rankCandidates,
  updateTrendPool,
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
  assert.equal(isGoodTrend("x".repeat(300), []), true); // within new 320 max
  assert.equal(isGoodTrend("x".repeat(400), []), false); // > max
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

test("parseArxivEntries extracts title + abs link, skipping the feed title", () => {
  const xml = `<?xml version="1.0"?>
    <feed>
      <title>ArXiv Query Feed</title>
      <entry><id>http://arxiv.org/abs/2401.00001v1</id><title>Scaling Laws for   Tiny Models</title></entry>
      <entry><id>http://arxiv.org/abs/2401.00002v2</id><title>Agents that Plan</title></entry>
    </feed>`;
  assert.deepEqual(parseArxivEntries(xml), [
    { title: "Scaling Laws for Tiny Models", url: "https://arxiv.org/abs/2401.00001v1" },
    { title: "Agents that Plan", url: "https://arxiv.org/abs/2401.00002v2" },
  ]);
  assert.deepEqual(parseArxivEntries(""), []);
});

test("scoreCandidate: arxiv fixed; hn capped, with technical boost", () => {
  assert.equal(scoreCandidate({ source: "arxiv" }), 80);
  assert.equal(scoreCandidate({ source: "hn", points: 5 }), 5); // below cap, no boost
  assert.equal(scoreCandidate({ source: "hn", points: 500 }), 60); // capped, no boost
  assert.equal(
    scoreCandidate({ source: "hn", points: 500, title: "My AI skeptic friends are all nuts" }),
    60,
  ); // opinion: capped, no technical signal
  assert.equal(
    scoreCandidate({ source: "hn", points: 500, title: "Open source AI is the path forward" }),
    60,
  ); // generic 'open source' is not a technical signal — must not out-rank real papers
  assert.equal(
    scoreCandidate({ source: "hn", points: 10, title: "Mistral releases new 7B open-weights model" }),
    130,
  ); // 10 + 120 boost
  assert.equal(
    scoreCandidate({ source: "hn", points: 500, title: "Llama 3 70B benchmark results" }),
    180,
  ); // capped 60 + 120 boost
  assert.equal(scoreCandidate(null), 0);
});

test("rankCandidates: technical HN > arxiv research > non-technical HN", () => {
  const list = [
    { title: "AI is going to ruin everything, says pundit", source: "hn", points: 800 },
    { title: "Scaling laws for sparse models", source: "arxiv" },
    { title: "Open-source 13B model released with weights", source: "hn", points: 30 },
  ];
  assert.deepEqual(rankCandidates(list).map((c) => c.title), [
    "Open-source 13B model released with weights",
    "Scaling laws for sparse models",
    "AI is going to ruin everything, says pundit",
  ]);
  // stable on ties + empty still hold
  const ties = [
    { title: "p1", source: "arxiv" },
    { title: "p2", source: "arxiv" },
  ];
  assert.deepEqual(rankCandidates(ties).map((c) => c.title), ["p1", "p2"]);
  assert.deepEqual(rankCandidates([]), []);
});

test("updateTrendPool adds next-best candidates, excluding the featured one", () => {
  const ranked = [
    { title: "Featured paper on scaling laws for sparse models", url: "" },
    { title: "A new mixture-of-experts router cuts decode latency", url: "http://a", source: "hn" },
    { title: "Quantized 7B model matches a 13B baseline on MMLU", url: "", source: "arxiv" },
  ];
  const pool = updateTrendPool([], ranked, ranked[0].title, [], {});
  assert.equal(pool.length, 2);
  assert.equal(pool[0].text, "A new mixture-of-experts router cuts decode latency");
  assert.equal(pool[0].link, "http://a");
});

test("updateTrendPool dedupes against existing entries and recent trends", () => {
  const existing = [{ text: "AI agents that plan multi-step actions reliably", link: "" }];
  const ranked = [
    { title: "Featured headline goes here for today only", url: "" },
    { title: "AI agents that plan multi-step actions reliably", url: "", source: "hn" },
    { title: "A trend we already showed in nuggets recently", url: "", source: "hn" },
  ];
  const out = updateTrendPool(existing, ranked, "Featured headline goes here for today only", [
    "A trend we already showed in nuggets recently",
  ], {});
  assert.equal(out.length, 1); // both additions filtered out
});

test("updateTrendPool purges pool entries that have since been featured (recentTitles)", () => {
  const existing = [
    { text: "DanceOPD: On-Policy Generative Field Distillation", link: "" },
    { text: "Some other still-fresh technical headline here", link: "" },
  ];
  // The DanceOPD topic was featured on an earlier day; its raw title is now a
  // recent title. It must be dropped so it can never be re-served from the pool.
  const out = updateTrendPool(existing, [], "", [], {
    recentTitles: ["DanceOPD: On-Policy Generative Field Distillation"],
  });
  assert.deepEqual(out.map((t) => t.text), ["Some other still-fresh technical headline here"]);
});

test("updateTrendPool caps the pool with FIFO eviction", () => {
  const existing = Array.from({ length: 24 }, (_, i) => ({
    text: `old pool entry number ${i} with padding text`,
    link: "",
  }));
  const ranked = [
    { title: "A brand new fresh headline about agent evals today", url: "", source: "hn" },
  ];
  const out = updateTrendPool(existing, ranked, "", [], { cap: 24 });
  assert.equal(out.length, 24);
  assert.equal(out[out.length - 1].text, "A brand new fresh headline about agent evals today");
  assert.equal(out[0].text, "old pool entry number 1 with padding text"); // index 0 evicted
});

test("updateTrendPool drops empty/too-short/too-long titles", () => {
  const ranked = [
    { title: "short", url: "", source: "hn" }, // < 20 chars
    { title: "", url: "", source: "hn" },
    { title: "x".repeat(400), url: "", source: "hn" }, // > maxLen
    { title: "A perfectly reasonable technical headline here", url: "", source: "hn" },
  ];
  const out = updateTrendPool([], ranked, "", [], {});
  assert.deepEqual(out.map((t) => t.text), ["A perfectly reasonable technical headline here"]);
});

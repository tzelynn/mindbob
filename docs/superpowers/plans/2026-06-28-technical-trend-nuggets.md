# Technical Trend Nuggets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the daily tech-trend nugget specific and technical (for AI/ML engineers), feature the most substantive recent item instead of the newest headline, and replace the stale static fallback with a self-replenishing pool of real recent headlines.

**Architecture:** All changes are in `scripts/generate-nuggets.mjs` plus a new committed data file `data/nugget-trend-pool.json`. New logic is added as pure, exported helpers (`scoreCandidate`, `rankCandidates`, `updateTrendPool`) unit-tested in `test/generate-nuggets.test.mjs`, matching the existing convention. Fallback order for a trend becomes **LLM → pool → static seed**.

**Tech Stack:** Vanilla Node.js (v20, built-in `fetch`, built-in test runner). No npm dependencies. ES modules.

## Global Constraints

- **No framework, no build step, no npm dependencies.** Vanilla Node ESM only.
- **All site paths relative**; data files live in `data/`.
- **Cron uses only the built-in `GITHUB_TOKEN`.** No external secrets.
- **Deterministic — no `Math.random()`.** Bank/pool picks rotate by entry count.
- **`main()` runs only when invoked directly** (the existing `import.meta.url === process.argv[1]` guard) so tests can import helpers safely.
- **Pure helpers are exported and unit-tested** (no network, no fs) per the existing file convention.
- **The fact path is unchanged** (uselessfacts API → `nugget-fallback-bank.json` `facts`). Only the trend path changes.
- **Notifications stay note-only** — do not touch `sw.js`, `js/`, or selection/parity logic.

---

### Task 1: Retarget the LLM prompt and relax the length cap

**Files:**
- Modify: `scripts/generate-nuggets.mjs` (constants `TREND_MAX`; `TREND_SYSTEM`; `trendFromLLM` `max_tokens`)
- Test: `test/generate-nuggets.test.mjs`

**Interfaces:**
- Consumes: existing `isGoodTrend(t, recent)` (uses `TREND_MAX`).
- Produces: `TREND_MAX` raised to `320` (later tasks' pool length filter defaults to it).

- [ ] **Step 1: Update the length-cap test to the new max**

In `test/generate-nuggets.test.mjs`, replace the over-long assertion in the `isGoodTrend` test (currently `assert.equal(isGoodTrend("x".repeat(300), []), false); // > max`) with:

```js
  assert.equal(isGoodTrend("x".repeat(300), []), true); // within new 320 max
  assert.equal(isGoodTrend("x".repeat(400), []), false); // > max
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/generate-nuggets.test.mjs`
Expected: FAIL — `isGoodTrend("x".repeat(300), [])` returns `false` (current max is 260), assertion expected `true`.

- [ ] **Step 3: Raise `TREND_MAX`**

In `scripts/generate-nuggets.mjs`, change:

```js
const TREND_MAX = 260;
```

to:

```js
const TREND_MAX = 320;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/generate-nuggets.test.mjs`
Expected: PASS.

- [ ] **Step 5: Rewrite `TREND_SYSTEM` and bump `max_tokens`**

In `scripts/generate-nuggets.mjs`, replace the `TREND_SYSTEM` constant with:

```js
const TREND_SYSTEM =
  "You write a single tech-trend nugget for an audience of working AI/ML engineers. " +
  "You are given one recent AI/ML development and some background headlines. " +
  "Write about that development specifically: name the model, method, or paper, and " +
  "include one concrete detail — a number, an architecture choice, a benchmark result, " +
  "or precisely what is new. " +
  "Assume the reader knows ML fundamentals; do not explain what a transformer, embedding, or RAG is. " +
  "One or two sentences, under 320 characters. " +
  "No hype, no buzzword soup, no emoji, no hashtags, no quotation marks, no preamble.";
```

In `trendFromLLM`, change `max_tokens: 120` to `max_tokens: 160`.

- [ ] **Step 6: Run the full test suite**

Run: `node --test`
Expected: PASS (all suites).

- [ ] **Step 7: Commit**

```bash
git add scripts/generate-nuggets.mjs test/generate-nuggets.test.mjs
git commit -m "feat: retarget trend nugget prompt at AI engineers, raise length cap"
```

---

### Task 2: Rank candidates by substance

**Files:**
- Modify: `scripts/generate-nuggets.mjs` (new `ARXIV_SCORE` const, `scoreCandidate`, `rankCandidates`; `HN_URL`; `trendCandidates` to tag `source`/`points`)
- Test: `test/generate-nuggets.test.mjs`

**Interfaces:**
- Consumes: existing `cleanText`.
- Produces:
  - `scoreCandidate(c)` → `number`. `c` is `{ title, url, source: "hn"|"arxiv", points? }`. arXiv → fixed `ARXIV_SCORE` (80); HN → its `points` (0 if missing).
  - `rankCandidates(list)` → new array sorted by score descending, **stable** (ties keep original order). Does not mutate input.
  - `trendCandidates()` now returns `{ title, url, source, points }` (HN: `source:"hn"`, real `points`; arXiv: `source:"arxiv"`).

- [ ] **Step 1: Write the failing tests**

Add to `test/generate-nuggets.test.mjs`:

```js
import {
  scoreCandidate,
  rankCandidates,
} from "../scripts/generate-nuggets.mjs";

test("scoreCandidate: arxiv gets a fixed score, hn scores by points", () => {
  assert.equal(scoreCandidate({ source: "arxiv" }), 80);
  assert.equal(scoreCandidate({ source: "hn", points: 150 }), 150);
  assert.equal(scoreCandidate({ source: "hn" }), 0);
  assert.equal(scoreCandidate(null), 0);
});

test("rankCandidates sorts by score desc, stable on ties", () => {
  const list = [
    { title: "hn small", source: "hn", points: 5 },
    { title: "paper", source: "arxiv" },
    { title: "hn big", source: "hn", points: 150 },
  ];
  assert.deepEqual(
    rankCandidates(list).map((c) => c.title),
    ["hn big", "paper", "hn small"],
  );
  // stable: equal-score arxiv papers keep input order
  const ties = [
    { title: "p1", source: "arxiv" },
    { title: "p2", source: "arxiv" },
  ];
  assert.deepEqual(rankCandidates(ties).map((c) => c.title), ["p1", "p2"]);
  assert.deepEqual(rankCandidates([]), []);
});
```

> Note: add the new names to the existing top-of-file import block from `../scripts/generate-nuggets.mjs` rather than duplicating the import if your runner complains; a second `import` from the same module is also valid ESM.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/generate-nuggets.test.mjs`
Expected: FAIL — `scoreCandidate`/`rankCandidates` are not exported (`SyntaxError` / `undefined is not a function`).

- [ ] **Step 3: Implement the ranking helpers**

In `scripts/generate-nuggets.mjs`, in the "Pure helpers" section (after `parseArxivTitles`), add:

```js
// Candidate scoring: real research (arXiv) sits among high-signal HN stories so
// big releases win on big days, otherwise a fresh paper wins. Deterministic.
const ARXIV_SCORE = 80;

export function scoreCandidate(c) {
  if (!c) return 0;
  if (c.source === "arxiv") return ARXIV_SCORE;
  const pts = Number(c.points);
  return Number.isFinite(pts) ? pts : 0;
}

// Stable sort by score descending (ties keep original/recency order). Pure.
export function rankCandidates(list) {
  const arr = Array.isArray(list) ? list : [];
  return arr
    .map((c, i) => ({ c, i, s: scoreCandidate(c) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.c);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/generate-nuggets.test.mjs`
Expected: PASS.

- [ ] **Step 5: Tag candidates with source/points and favor substantive HN stories**

In `scripts/generate-nuggets.mjs`, change `HN_URL` from the `search_by_date` query to a points-floored relevance query:

```js
const HN_URL =
  "https://hn.algolia.com/api/v1/search?tags=story&query=AI&numericFilters=points%3E20&hitsPerPage=20";
```

In `trendCandidates`, update the two push sites to carry `source` and `points`:

```js
    const hn = await fetchJson(HN_URL);
    for (const hit of hn?.hits || []) {
      const title = cleanText(hit?.title);
      if (title)
        out.push({
          title,
          url: hit?.url || hit?.story_url || "",
          source: "hn",
          points: Number(hit?.points) || 0,
        });
    }
```

```js
    const xml = await fetchText(ARXIV_URL);
    for (const title of parseArxivTitles(xml))
      out.push({ title, url: "", source: "arxiv" });
```

- [ ] **Step 6: Run the full test suite**

Run: `node --test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/generate-nuggets.mjs test/generate-nuggets.test.mjs
git commit -m "feat: rank trend candidates by substance (arxiv + hn points)"
```

---

### Task 3: Self-replenishing trend pool helper

**Files:**
- Modify: `scripts/generate-nuggets.mjs` (`POOL_CAP`, `POOL_ADD` consts; `updateTrendPool`)
- Test: `test/generate-nuggets.test.mjs`

**Interfaces:**
- Consumes: `cleanText`, `TREND_MAX`.
- Produces: `updateTrendPool(existing, ranked, featuredText, recentTrends, opts)` → new array of `{ text, link }`.
  - `existing`: current pool array `[{ text, link }]`.
  - `ranked`: ranked candidates `[{ title, url, ... }]`.
  - `featuredText`: the title featured today (excluded from additions).
  - `recentTrends`: `string[]` of recently-shown trend texts to avoid.
  - `opts`: `{ maxAdd = POOL_ADD (4), cap = POOL_CAP (24), maxLen = TREND_MAX (320) }`.
  - Adds up to `maxAdd` cleaned candidate titles, skipping the featured one, empties, titles shorter than 20 or longer than `maxLen`, and any text already in the pool or in `recentTrends` (deduped within the batch too). Appends to the end; returns the **last `cap`** entries (FIFO eviction of oldest). Pure — does not mutate `existing`.

- [ ] **Step 1: Write the failing tests**

Add to `test/generate-nuggets.test.mjs`:

```js
import { updateTrendPool } from "../scripts/generate-nuggets.mjs";

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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/generate-nuggets.test.mjs`
Expected: FAIL — `updateTrendPool` is not exported.

- [ ] **Step 3: Implement `updateTrendPool`**

In `scripts/generate-nuggets.mjs`, add the constants near the other top-level consts (after `TREND_MAX`):

```js
const POOL_CAP = 24; // rolling trend pool size; oldest evicted FIFO
const POOL_ADD = 4; // max candidates banked per run ("not everything")
```

And add the helper in the "Pure helpers" section (after `rankCandidates`):

```js
// Self-replenishing trend pool: bank the next-best candidates we saw but did
// not feature, so the fallback degrades to real recent headlines instead of a
// stale curated list. Pure: returns a new capped array, oldest evicted FIFO.
export function updateTrendPool(existing, ranked, featuredText, recentTrends, opts = {}) {
  const cap = opts.cap ?? POOL_CAP;
  const maxAdd = opts.maxAdd ?? POOL_ADD;
  const maxLen = opts.maxLen ?? TREND_MAX;
  const pool = Array.isArray(existing) ? existing.slice() : [];
  const featured = cleanText(featuredText);
  const seen = new Set([...pool.map((t) => t.text), ...(recentTrends || [])]);
  let added = 0;
  for (const c of Array.isArray(ranked) ? ranked : []) {
    if (added >= maxAdd) break;
    const text = cleanText(c?.title);
    if (!text || text === featured) continue;
    if (text.length < 20 || text.length > maxLen) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    pool.push({ text, link: c?.url || "" });
    added += 1;
  }
  return pool.slice(-cap);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/generate-nuggets.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the full test suite**

Run: `node --test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/generate-nuggets.mjs test/generate-nuggets.test.mjs
git commit -m "feat: add self-replenishing trend pool helper"
```

---

### Task 4: Wire ranking + pool into trend generation

**Files:**
- Create: `data/nugget-trend-pool.json`
- Modify: `scripts/generate-nuggets.mjs` (`POOL_PATH`; `trendFromLLM` to use ranked + source-tagged context; `buildTrend`; `main`)

**Interfaces:**
- Consumes: `rankCandidates`, `updateTrendPool`, `trendCandidates`, `trendFromLLM`, `isGoodTrend`, `pickFromBank`, existing `readJson`/`writeFile`/`publishAtFor`.
- Produces: trend objects with `source: "llm" | "pool" | "bank"`. `buildTrend` returns `{ trend, poolTrends }`; `main` writes `poolTrends` to `data/nugget-trend-pool.json`.

- [ ] **Step 1: Create the initial pool file**

Create `data/nugget-trend-pool.json`:

```json
{
  "updated": "",
  "trends": []
}
```

- [ ] **Step 2: Add the pool path constant**

In `scripts/generate-nuggets.mjs`, next to `BANK_PATH`:

```js
const POOL_PATH = join(ROOT, "data", "nugget-trend-pool.json");
```

- [ ] **Step 3: Feature the top-ranked candidate and tag context by source in `trendFromLLM`**

In `trendFromLLM`, the parameter is already named `candidates`; callers will pass the **ranked** list. Update the `context` map to include the source tag:

```js
  const primary = candidates[0];
  const context = candidates
    .slice(0, 8)
    .map((c) => "- [" + (c.source || "?") + "] " + c.title)
    .join("\n");
```

(Leave the rest of `trendFromLLM` unchanged — `primary.title` / `primary.url` still drive the nugget and link.)

- [ ] **Step 4: Rewrite `buildTrend` to rank, feature, bank, and fall back**

Replace the existing `buildTrend` function with:

```js
async function buildTrend(bank, pool, recentTrends, entryCount) {
  let ranked = [];
  let trend = null;

  try {
    ranked = rankCandidates(await trendCandidates());
    const { text, link } = await trendFromLLM(ranked);
    if (isGoodTrend(text, recentTrends)) {
      trend = { text, source: "llm" };
      if (link) trend.link = link;
    } else {
      throw new Error("low-quality trend: " + JSON.stringify(text));
    }
  } catch (err) {
    console.warn("[nuggets] trend LLM unavailable:", err.message);
  }

  // Bank the next-best candidates we did not feature (before choosing a
  // fallback, so today's leftovers are eligible).
  const featuredTitle = ranked[0]?.title || "";
  const poolTrends = updateTrendPool(
    pool.trends || [],
    ranked,
    featuredTitle,
    recentTrends,
    {},
  );

  if (!trend) {
    const fromPool = pickFromBank(
      poolTrends.map((t) => t.text),
      recentTrends,
      entryCount,
    );
    if (fromPool) {
      trend = { text: fromPool, source: "pool" };
      const hit = poolTrends.find((t) => t.text === fromPool);
      if (hit?.link) trend.link = hit.link;
    } else {
      trend = {
        text: pickFromBank(bank.trends, recentTrends, entryCount),
        source: "bank",
      };
    }
  }

  return { trend, poolTrends };
}
```

- [ ] **Step 5: Update `main` to load/pass/write the pool**

In `main`, after `const bank = await readJson(...)`, add:

```js
  const pool = await readJson(POOL_PATH, { updated: "", trends: [] });
  if (!Array.isArray(pool.trends)) pool.trends = [];
```

Change the `Promise.all` block so `buildTrend` receives `pool` and its result is destructured:

```js
  const [fact, built] = await Promise.all([
    buildFact(bank, recentFacts, count),
    buildTrend(bank, pool, recentTrends, count),
  ]);
  const trend = built.trend;
```

After `await writeFile(NUGGETS_PATH, ...)`, add a write for the pool:

```js
  await writeFile(
    POOL_PATH,
    JSON.stringify({ updated: now.toISOString(), trends: built.poolTrends }, null, 2) + "\n",
  );
```

(The `entry` construction `{ ..., fact, trend }` is unchanged — `trend` now comes from `built.trend`.)

- [ ] **Step 6: Verify the unit tests still pass**

Run: `node --test`
Expected: PASS (helpers unchanged in behavior; `main` is not exercised by tests).

- [ ] **Step 7: Run the generator end-to-end (no token → exercises ranking + pool fallback)**

Run: `node scripts/generate-nuggets.mjs`
Expected: console line `[nuggets] <date> — fact(...), trend(pool)` (locally there is no `GITHUB_TOKEN`, so the LLM path is skipped and the trend is drawn from the freshly-populated pool). If the network is unreachable it prints `trend(bank)` instead — both are acceptable.

- [ ] **Step 8: Inspect the written files**

Run: `git --no-pager diff data/nuggets.json data/nugget-trend-pool.json`
Expected: `data/nugget-trend-pool.json` now contains several real recent headlines under `trends`; `data/nuggets.json`'s trend has `source: "pool"` (or `"bank"` if offline) and a specific headline text.

- [ ] **Step 9: Commit**

```bash
git add scripts/generate-nuggets.mjs data/nugget-trend-pool.json data/nuggets.json
git commit -m "feat: feature top-ranked trend and fall back to self-replenishing pool"
```

---

### Task 5: Plumbing — cron commit + docs

**Files:**
- Modify: `.github/workflows/generate-message.yml` (the `git add` line)
- Modify: `CLAUDE.md` (nuggets contract + generation-strategy docs)

**Interfaces:**
- Consumes: nothing (documentation + CI).
- Produces: the cron commits the new pool file; docs reflect `source: "pool"` and the LLM → pool → seed fallback order.

- [ ] **Step 1: Add the pool file to the cron commit**

In `.github/workflows/generate-message.yml`, change the `git add` line:

```yaml
          git add data/messages.json data/prompts.json data/nuggets.json data/nugget-trend-pool.json doodles/index.json
```

- [ ] **Step 2: Update the CLAUDE.md nuggets contract**

In `CLAUDE.md`, in the Nuggets contract JSON block, change the `trend` source enum to include `pool`:

```json
      "trend": { "text": "...", "source": "llm|pool|bank|builtin", "link": "optional-url" } } ] }
```

- [ ] **Step 3: Update the CLAUDE.md generation-strategy bullet**

In `CLAUDE.md`, replace the `tech trend` bullet under "generation strategy" with one that reflects the new audience, ranking, and fallback order:

```markdown
- **tech trend** → fetch recent AI/ML headlines from Hacker News (Algolia, points-floored) + arXiv (cs.AI/cs.LG), rank them by substance (`rankCandidates`: arXiv research sits among high-point HN stories), feature the top one, and have GitHub Models write one **technical** nugget for AI/ML engineers (names a specific model/method/paper + a concrete detail; attaches the headline's `link`). Fallback order: **LLM → self-replenishing pool → static seed**.
- **trend pool** (`data/nugget-trend-pool.json`) — the next-best candidates we saw but did not feature are banked here (`updateTrendPool`: up to 4/run, capped at 24, FIFO, deduped against the pool and recent trends). When the LLM is unavailable, the trend is drawn from this pool (`source: "pool"`, a cleaned real headline); only if the pool is empty does it fall back to the static `nugget-fallback-bank.json` `trends` (`source: "bank"`). The fact path is unchanged.
```

- [ ] **Step 4: Run the full test suite as a final check**

Run: `node --test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/generate-message.yml CLAUDE.md
git commit -m "chore: commit trend pool in cron, document technical trend nuggets"
```

---

## Notes for the implementer

- The pool fallback intentionally displays a **cleaned raw headline** (e.g. an arXiv paper title), not LLM-polished prose — this is more specific/technical and is the only thing that works when the LLM is unavailable (exactly when the fallback fires).
- Determinism matters: pool/bank picks use `pickFromBank` (rotate by entry count), never `Math.random()`.
- Do not touch `sw.js`, `js/`, or notification/selection/parity logic — nuggets never trigger notifications.

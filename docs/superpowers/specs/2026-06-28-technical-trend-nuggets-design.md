# Technical trend nuggets — design

**Date:** 2026-06-28
**Status:** Approved (pending spec review)
**Area:** `scripts/generate-nuggets.mjs`, `data/`, cron workflow, tests

## Problem

The daily tech-trend nugget is too simplistic. `TREND_SYSTEM` targets "a curious
non-expert" and bans technical depth, and the fallback bank trends are
deliberately generic ("RAG has become standard", "AI agents are hot"). The real
audience is working AI/ML engineers, who want a specific concept, research
finding, or model release with a concrete detail.

Only the **trend** path changes. The **fact** path (uselessfacts API → static
`nugget-fallback-bank.json` `facts`) is untouched. Notifications stay note-only
(nuggets never trigger them), so `sw.js` / selection / parity logic is untouched.

## Goals

1. Trend nuggets name a specific model / method / paper and include one concrete
   detail (a number, architecture choice, benchmark result, or what is new).
2. Source selection features the most *substantive* recent item, not merely the
   newest headline.
3. The fallback degrades to **real recent headlines** instead of a stale curated
   list — a self-replenishing pool fed by candidates we saw but didn't feature.

## Non-goals

- No change to the fact path.
- No change to notifications, `sw.js`, or `js/` frontend (the client reads
  `nuggets.json` and is agnostic to how the trend was produced; `source` values
  are not branched on in the UI).
- No new npm dependencies; pure-helper + unit-test convention preserved.

## Design

### 1. Retarget the LLM prompt

Rewrite `TREND_SYSTEM` so the audience is working AI/ML engineers:

- Pick the single most substantive item from the provided candidates.
- Name the specific model / method / paper.
- Include one concrete detail: a number, an architecture choice, a benchmark
  result, or precisely what is new.
- Assume the reader knows ML fundamentals — do **not** explain what a transformer
  / embedding / RAG is.
- Keep existing bans: no hype, no buzzword soup, no emoji, no hashtags, no
  quotation marks, no preamble. One or two sentences.

Bump the LLM `max_tokens` 120 → 160 to give room for a precise sentence.

### 2. Improve source selection

Today `trendFromLLM` blindly features `candidates[0]` (the newest HN "AI" story,
often noise). Instead:

- `trendCandidates()` tags each candidate with `source` (`"arxiv"` | `"hn"`) and
  carries HN `points` (parsed from the HN response).
- A pure `scoreCandidate(candidate)` / `rankCandidates(list)` helper sorts
  candidates so real research (arXiv) and high-signal HN stories rank above the
  long tail. Heuristic: arXiv papers get a strong base score; HN stories score by
  `points`. Ties broken by original order (recency).
- Switch the HN query so substantive stories surface (favor points/relevance over
  pure recency).
- `trendFromLLM` features the **top-ranked** candidate (`ranked[0]`) and feeds the
  top ~8 as background context. Link mapping stays trivial: the featured
  candidate's `url`.

### 3. Relax length cap

`TREND_MAX` 260 → **320** so a nugget can name the thing *and* a key metric.
`isGoodTrend` minimum is unchanged. `max_tokens` already covers 320 chars.

### 4. Self-replenishing trend pool

New committed file **`data/nugget-trend-pool.json`**:

```json
{ "updated": "ISO", "trends": [ { "text": "cleaned headline", "link": "url" } ] }
```

Lifecycle:

- **Populate (on successful candidate fetch):** take the **next-best few unused
  candidates** — the ranked candidates after the featured one — cap at ~4 added
  per day ("not everything"). Clean each title, drop ones that are empty / too
  long / duplicate an existing pool entry or a recently-featured trend, then
  append `{ text, link }`.
- **Cap:** pool holds at most **24** entries; oldest evicted FIFO as it grows.
- **Consume (fallback):** when the LLM trend is unavailable or low-quality, pick
  from the pool using the existing deterministic `pickFromBank` rotation (rotate
  by entry count, avoid recently-shown; no `Math.random`). `source: "pool"`.
- **Last-resort backstop:** if the pool is empty (cold start, or a run where the
  network was fully down), fall back to the static `nugget-fallback-bank.json`
  `trends`, `source: "bank"`. The static seed is kept only for this case.

Fallback order for a trend: **LLM → pool → static seed.**

Note: a pool fallback displays a **cleaned raw headline** (e.g. an arXiv title),
not LLM-polished prose. This is intentional — it is more specific/technical than
the old generic bank lines, and it is the only option that works when the LLM is
unavailable (exactly when the fallback fires).

"Not shortlisted" is read as *"the good candidates we didn't feature today"*:
featured = the one item the LLM wrote about; the pool gets the next-best few
unused ones (higher quality than the long tail), capped and FIFO.

### 5. Plumbing

- `.github/workflows/generate-message.yml`: add `data/nugget-trend-pool.json` to
  the `git add` line.
- CLAUDE.md: update the nuggets contract doc — trend `source` enum gains
  `"pool"`; document `data/nugget-trend-pool.json` and the LLM → pool → seed
  fallback order.

## Data shapes

`data/nuggets.json` (unchanged shape; `trend.source` may now be `"pool"`):

```json
{ "trend": { "text": "...", "source": "llm|pool|bank|builtin", "link": "url" } }
```

`data/nugget-trend-pool.json` (new):

```json
{ "updated": "ISO", "trends": [ { "text": "...", "link": "..." } ] }
```

## Testing

New / updated pure helpers, exported and unit-tested in
`test/generate-nuggets.test.mjs` (Node built-in runner, no deps), per the
existing convention:

- `scoreCandidate` / `rankCandidates` — arXiv outranks low-point HN; ties keep
  order; mixed list sorts as expected.
- HN points parsing — `points` carried onto candidates.
- pool update helper — adds next-best few, caps at the limit with FIFO eviction,
  dedupes against existing entries and recent trends, drops empty/over-long.
- existing `cleanText` / `isGoodFact` / `isGoodTrend` / `pickFromBank` /
  `parseArxivTitles` tests stay green (`TREND_MAX` bump may adjust one length
  assertion).

`main()` still runs only when invoked directly, so tests import helpers safely.

## Risks / trade-offs

- Pool fallbacks are raw headlines, not prose (accepted above).
- A static seed is still required for cold start / total network failure.
- HN ranking by points can lag very fresh model releases (low points early); the
  arXiv base score and the LLM's "pick the most substantive" instruction
  mitigate this.

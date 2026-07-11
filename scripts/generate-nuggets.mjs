// Generates the two daily "nuggets" and writes them to data/nuggets.json.
//
//   node scripts/generate-nuggets.mjs
//
// One entry per day, generated each morning alongside the note + doodle prompt:
//   - fact:  an interesting, not-commonly-known fun fact
//   - trend: a recent AI/ML (or broadly groundbreaking) tech development
//
// Dynamic as far as possible, using only free, no-auth sources reachable from
// the Actions runner:
//   - fun fact   -> uselessfacts API (free, no key)
//   - tech trend -> recent Hacker News + arXiv headlines, rewritten into a
//                   friendly nugget by GitHub Models (free, uses GITHUB_TOKEN)
// Every network call is wrapped so a dead source degrades to the curated
// data/nugget-fallback-bank.json — a fresh pair of nuggets ALWAYS lands.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fetchWithRetry, planWork, isForced, LLM_TIMEOUT, SOURCE_TIMEOUT } from "./lib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NUGGETS_PATH = join(ROOT, "data", "nuggets.json");
const BANK_PATH = join(ROOT, "data", "nugget-fallback-bank.json");
const POOL_PATH = join(ROOT, "data", "nugget-trend-pool.json");

const API_URL = "https://models.github.ai/inference/chat/completions";
const MODEL = "openai/gpt-4o-mini";
const KEEP = 14;
const FACT_MAX = 240;
const TREND_MAX = 320;
const POOL_CAP = 24; // rolling trend pool size; oldest evicted FIFO
const POOL_ADD = 4; // max candidates banked per run ("not everything")

const FACTS_URL = "https://uselessfacts.jsph.pl/api/v2/facts/random?language=en";
const HN_URL =
  "https://hn.algolia.com/api/v1/search?tags=story&query=AI&hitsPerPage=20";
const ARXIV_URL =
  "http://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.LG&sortBy=submittedDate&sortOrder=descending&max_results=10";

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests; no network, no fs).
// ---------------------------------------------------------------------------

export function cleanText(text) {
  if (!text) return "";
  let t = String(text).trim();
  t = t.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim(); // strip wrapping quotes
  t = t.replace(/\s+/g, " ");
  return t;
}

export function isGoodText(t, { min, max, recent = [] }) {
  if (!t) return false;
  if (t.length < min || t.length > max) return false;
  if (/\bI (can't|cannot|won't|am unable)\b/i.test(t)) return false; // refusal
  if (recent.includes(t)) return false; // dedupe
  return true;
}

export const isGoodFact = (t, recent) =>
  isGoodText(t, { min: 12, max: FACT_MAX, recent });
export const isGoodTrend = (t, recent) =>
  isGoodText(t, { min: 20, max: TREND_MAX, recent });

// Deterministic pick from a bank: rotate by entry count (no Math.random), and
// avoid anything already shown recently when possible.
export function pickFromBank(bank, recent, entryCount) {
  const list = Array.isArray(bank) ? bank : [];
  if (!list.length) return "";
  const pool = list.filter((t) => !recent.includes(t));
  const choices = pool.length ? pool : list;
  return choices[entryCount % choices.length];
}

// Parse each <entry> out of an arXiv Atom feed into { title, url }. The url is
// the entry's <id> (its abs page, e.g. https://arxiv.org/abs/2401.00001), so a
// featured arXiv paper links to the paper itself. The feed's own <title> sits
// outside any <entry>, so iterating entries skips it naturally.
export function parseArxivEntries(xml) {
  if (!xml) return [];
  const out = [];
  const entryRe = /<entry\b([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRe.exec(xml)) !== null) {
    const block = m[1];
    const title = cleanText((/<title>([\s\S]*?)<\/title>/.exec(block)?.[1] || "").replace(/\s+/g, " "));
    if (!title) continue;
    let url = cleanText(/<id>([\s\S]*?)<\/id>/.exec(block)?.[1] || "");
    if (url.startsWith("http://")) url = "https://" + url.slice(7); // arXiv ids are http
    out.push({ title, url });
  }
  return out;
}

// Candidate scoring. arXiv research sits mid-tier (reliably technical). Raw HN
// points are capped so a high-traffic opinion/drama post cannot dominate the
// featured slot; HN titles with a strong technical signal (releases, papers,
// param sizes, open weights, etc.) are boosted above arXiv. Net order:
// technical HN > arXiv research > non-technical HN. Deterministic, pure.
const ARXIV_SCORE = 80;
const HN_POINTS_CAP = 60; // raw HN points contribute at most this (< ARXIV_SCORE)
const HN_TECH_BOOST = 120; // HN titles with a technical signal jump above arXiv
// A "technical signal" means a concrete model/method/result — NOT generic
// commentary. Bare "open source" / "weights" were dropped: opinion/drama posts
// ("Open source AI is the path forward") tripped them and out-ranked real
// papers, which then mismatched the featured link. "open-weights" is kept.
const TECH_RE =
  /\b(?:release[ds]?|launch(?:e[ds]|ing)?|open[- ]?weights?|fine[- ]?tun\w*|quantiz\w*|distill\w*|benchmark|state[- ]of[- ]the[- ]art|sota|checkpoint|pre[- ]?train\w*|mixture[- ]of[- ]experts|moe|context window|\d+\s?[bB])\b/i;

export function scoreCandidate(c) {
  if (!c) return 0;
  if (c.source === "arxiv") return ARXIV_SCORE;
  const pts = Number(c.points);
  let s = Number.isFinite(pts) ? Math.min(pts, HN_POINTS_CAP) : 0;
  if (TECH_RE.test(c.title || "")) s += HN_TECH_BOOST;
  return s;
}

// Stable sort by score descending (ties keep original/recency order). Pure.
export function rankCandidates(list) {
  const arr = Array.isArray(list) ? list : [];
  return arr
    .map((c, i) => ({ c, i, s: scoreCandidate(c) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.c);
}

// Self-replenishing trend pool: bank the next-best candidates we saw but did
// not feature, so the fallback degrades to real recent headlines instead of a
// stale curated list. Pure: returns a new capped array, oldest evicted FIFO.
export function updateTrendPool(existing, ranked, featuredText, recentTrends, opts = {}) {
  const cap = opts.cap ?? POOL_CAP;
  const maxAdd = opts.maxAdd ?? POOL_ADD;
  const maxLen = opts.maxLen ?? TREND_MAX;
  const recentTitles = (opts.recentTitles || []).map(cleanText);
  const featured = cleanText(featuredText);
  // Anything already featured (today or on a recent day, by raw title or by the
  // rendered trend text) must never live in the pool — else it gets re-served as
  // a "repeat". Purge such entries from the existing pool, not just skip adds.
  const blocked = new Set([featured, ...recentTitles, ...(recentTrends || [])].filter(Boolean));
  const pool = (Array.isArray(existing) ? existing : []).filter((t) => !blocked.has(t.text));
  const seen = new Set([...pool.map((t) => t.text), ...blocked]);
  let added = 0;
  for (const c of Array.isArray(ranked) ? ranked : []) {
    if (added >= maxAdd) break;
    const text = cleanText(c?.title);
    if (!text) continue;
    if (text.length < 20 || text.length > maxLen) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    pool.push({ text, link: c?.url || "" });
    added += 1;
  }
  return pool.slice(-cap);
}

// ---------------------------------------------------------------------------
// IO helpers.
// ---------------------------------------------------------------------------

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// Anchored to the date (morning slot, 00:00 UTC), NOT wall-clock now, so the
// client's publishAt selection stays stable (mirrors the message generator).
function publishAtFor(date) {
  return `${date}T00:00:00.000Z`;
}

// 2 attempts is enough for the headline/fact sources — they already sit in
// front of a rich fallback chain, and it keeps the job short.
async function fetchJson(url) {
  const res = await fetchWithRetry(url, {}, { attempts: 2, timeoutMs: SOURCE_TIMEOUT });
  return res.json();
}

async function fetchText(url) {
  const res = await fetchWithRetry(url, {}, { attempts: 2, timeoutMs: SOURCE_TIMEOUT });
  return res.text();
}

// ---------------------------------------------------------------------------
// Fun fact: free facts API, with bank fallback.
// ---------------------------------------------------------------------------

async function factFromApi() {
  const data = await fetchJson(FACTS_URL);
  return cleanText(data?.text);
}

// ---------------------------------------------------------------------------
// Tech trend: gather recent headlines, then have the LLM write one nugget.
// ---------------------------------------------------------------------------

// Returns [{ title, url, source, points? }] of recent AI/ML headlines from free sources.
async function trendCandidates() {
  const out = [];

  try {
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
  } catch (err) {
    console.warn("[nuggets] Hacker News fetch failed:", err.message);
  }

  try {
    const xml = await fetchText(ARXIV_URL);
    for (const { title, url } of parseArxivEntries(xml))
      out.push({ title, url, source: "arxiv" });
  } catch (err) {
    console.warn("[nuggets] arXiv fetch failed:", err.message);
  }

  return out;
}

const TREND_SYSTEM =
  "You write a single tech-trend nugget for an audience of working AI/ML engineers. " +
  "You are given the title of ONE recent AI/ML paper or development. " +
  "Write one or two sentences about THAT title and nothing else — name the model, " +
  "method, or paper and say what is new about it. " +
  "Do not invent specific statistics, benchmark scores, or percentage improvements: " +
  "state only what the title itself makes clear plus context an ML engineer would already know. " +
  "Assume the reader knows ML fundamentals; do not explain what a transformer, embedding, or RAG is. " +
  "Under 320 characters. " +
  "No hype, no buzzword soup, no emoji, no hashtags, no quotation marks, no preamble.";

async function trendFromLLM(candidates) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("no GITHUB_TOKEN");
  if (!candidates.length) throw new Error("no candidate headlines");

  const primary = candidates[0];

  // Only the featured title is sent. Feeding a background list made the model
  // drift and write about a *different* headline than `primary`, so the
  // attached link (primary.url) no longer matched the nugget text.
  const userContent =
    "Write today's tech-trend nugget about this and only this development:\n" +
    `"${primary.title}"`;

  const res = await fetchWithRetry(
    API_URL,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2026-03-10",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.7,
        max_tokens: 160,
        messages: [
          { role: "system", content: TREND_SYSTEM },
          { role: "user", content: userContent },
        ],
      }),
    },
    { timeoutMs: LLM_TIMEOUT },
  );

  const data = await res.json();
  return {
    text: cleanText(data?.choices?.[0]?.message?.content),
    link: primary.url || "",
    title: primary.title, // the raw featured title, tracked for cross-day dedupe
  };
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

// action: "generate" (full run incl. bank fallback) | "retry" (attempt an
// upgrade; on failure keep `existingFact` untouched). `changed` tells main()
// whether anything actually needs writing.
async function buildFact(bank, recentFacts, entryCount, action, existingFact) {
  try {
    const candidate = await factFromApi();
    if (isGoodFact(candidate, recentFacts))
      return { fact: { text: candidate, source: "api" }, changed: true };
    throw new Error("low-quality fact: " + JSON.stringify(candidate));
  } catch (err) {
    if (action === "retry") {
      console.warn(`[nuggets] fact retry failed, keeping existing ${existingFact.source} fact:`, err.message);
      return { fact: existingFact, changed: false };
    }
    console.warn("[nuggets] falling back to fact bank:", err.message);
    return {
      fact: { text: pickFromBank(bank.facts, recentFacts, entryCount), source: "bank" },
      changed: true,
    };
  }
}

// Same contract as buildFact. On a failed retry the existing trend is kept and
// poolTrends is null — the pool file is only rewritten when the entry changed,
// so a no-op retry run stays byte-identical (no commit, no Pages redeploy).
async function buildTrend(bank, pool, recentTrends, recentTitles, entryCount, action, existingTrend) {
  let ranked = [];
  let trend = null;

  try {
    ranked = rankCandidates(await trendCandidates());
    const { text, link, title } = await trendFromLLM(ranked);
    if (isGoodTrend(text, recentTrends)) {
      trend = { text, source: "llm", title };
      if (link) trend.link = link;
    } else {
      throw new Error("low-quality trend: " + JSON.stringify(text));
    }
  } catch (err) {
    console.warn("[nuggets] trend LLM unavailable:", err.message);
  }

  if (!trend && action === "retry") {
    console.warn(`[nuggets] trend retry failed, keeping existing ${existingTrend.source} trend`);
    return { trend: existingTrend, poolTrends: null, changed: false };
  }

  // Bank the next-best candidates we did not feature (before choosing a
  // fallback, so today's leftovers are eligible). Recent raw titles are passed
  // so a topic already featured on a past day is purged from the pool.
  const featuredTitle = ranked[0]?.title || "";
  const poolTrends = updateTrendPool(pool.trends || [], ranked, featuredTitle, recentTrends, {
    recentTitles,
  });

  if (!trend) {
    // Dedupe pool picks against both rendered trend text AND recent raw titles,
    // so a headline whose topic we already featured can't reappear.
    const seenRecently = [...recentTrends, ...recentTitles];
    const fromPool = pickFromBank(
      poolTrends.map((t) => t.text),
      seenRecently,
      entryCount,
    );
    if (fromPool) {
      trend = { text: fromPool, source: "pool", title: fromPool };
      const hit = poolTrends.find((t) => t.text === fromPool);
      if (hit?.link) trend.link = hit.link;
    } else {
      const fromBank = pickFromBank(bank.trends, seenRecently, entryCount);
      trend = { text: fromBank, source: "bank", title: fromBank };
    }
  }

  return { trend, poolTrends, changed: true };
}

async function main() {
  const store = await readJson(NUGGETS_PATH, { updated: "", entries: [] });
  if (!Array.isArray(store.entries)) store.entries = [];
  const bank = await readJson(BANK_PATH, { facts: [], trends: [] });
  const pool = await readJson(POOL_PATH, { updated: "", trends: [] });
  if (!Array.isArray(pool.trends)) pool.trends = [];

  const date = todayUTC();

  // Upgrade-only, decided per part: a good "api" fact is kept while a
  // pool/bank trend retries, and vice versa. A retry can never downgrade.
  const existing = store.entries.find((e) => e.id === date);
  const force = isForced();
  const factAction = planWork(existing?.fact?.source, "api", force);
  const trendAction = planWork(existing?.trend?.source, "llm", force);
  if (factAction === "skip" && trendAction === "skip") {
    console.log(`[nuggets] ${date} already api+llm — skipping`);
    return;
  }

  const recentFacts = store.entries.map((e) => e.fact?.text).filter(Boolean);
  const recentTrends = store.entries.map((e) => e.trend?.text).filter(Boolean);
  // Raw source titles of past featured trends (LLM rewrites the title, so the
  // rendered text alone can't catch a repeat of the same underlying paper).
  const recentTitles = store.entries.map((e) => e.trend?.title).filter(Boolean);
  const count = store.entries.length;

  const [factRes, trendRes] = await Promise.all([
    factAction === "skip"
      ? null
      : buildFact(bank, recentFacts, count, factAction, existing?.fact),
    trendAction === "skip"
      ? null
      : buildTrend(bank, pool, recentTrends, recentTitles, count, trendAction, existing?.trend),
  ]);

  // Kept parts reuse the existing objects verbatim, so their serialization
  // (including link/title) stays byte-identical.
  const fact = factRes ? factRes.fact : existing.fact;
  const trend = trendRes ? trendRes.trend : existing.trend;
  const poolTrends = trendRes ? trendRes.poolTrends : null;
  const changed = Boolean(factRes?.changed || trendRes?.changed);

  if (!changed) {
    console.log(`[nuggets] ${date} retry produced no upgrade — keeping existing entry`);
    return;
  }

  const now = new Date();
  const entry = { id: date, date, publishAt: publishAtFor(date), fact, trend };

  // replace same-id entry if re-run, else append; keep most recent KEEP
  store.entries = store.entries.filter((e) => e.id !== entry.id);
  store.entries.push(entry);
  store.entries.sort((a, b) => new Date(a.publishAt) - new Date(b.publishAt));
  store.entries = store.entries.slice(-KEEP);
  store.updated = now.toISOString();

  await writeFile(NUGGETS_PATH, JSON.stringify(store, null, 2) + "\n");
  if (poolTrends) {
    await writeFile(
      POOL_PATH,
      JSON.stringify({ updated: now.toISOString(), trends: poolTrends }, null, 2) + "\n",
    );
  }
  console.log(
    `[nuggets] ${entry.id} — fact(${fact.source}), trend(${trend.source})`
  );
}

// Run only when invoked directly, so tests can import the pure helpers above.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

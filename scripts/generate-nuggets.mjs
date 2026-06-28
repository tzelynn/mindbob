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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NUGGETS_PATH = join(ROOT, "data", "nuggets.json");
const BANK_PATH = join(ROOT, "data", "nugget-fallback-bank.json");

const API_URL = "https://models.github.ai/inference/chat/completions";
const MODEL = "openai/gpt-4o-mini";
const KEEP = 14;
const FACT_MAX = 240;
const TREND_MAX = 320;
const FETCH_TIMEOUT = 8000;

const FACTS_URL = "https://uselessfacts.jsph.pl/api/v2/facts/random?language=en";
const HN_URL =
  "https://hn.algolia.com/api/v1/search?tags=story&query=AI&numericFilters=points%3E20&hitsPerPage=20";
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

// Parse <title> entries out of an arXiv Atom feed. The first <title> is the
// feed title itself, so it is skipped.
export function parseArxivTitles(xml) {
  if (!xml) return [];
  const titles = [];
  const re = /<entry\b[\s\S]*?<title>([\s\S]*?)<\/title>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const t = cleanText(m[1].replace(/\s+/g, " "));
    if (t) titles.push(t);
  }
  return titles;
}

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

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
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
    for (const title of parseArxivTitles(xml))
      out.push({ title, url: "", source: "arxiv" });
  } catch (err) {
    console.warn("[nuggets] arXiv fetch failed:", err.message);
  }

  return out;
}

const TREND_SYSTEM =
  "You write a single tech-trend nugget for an audience of working AI/ML engineers. " +
  "You are given one recent AI/ML development and some background headlines. " +
  "Write about that development specifically: name the model, method, or paper, and " +
  "include one concrete detail — a number, an architecture choice, a benchmark result, " +
  "or precisely what is new. " +
  "Assume the reader knows ML fundamentals; do not explain what a transformer, embedding, or RAG is. " +
  "One or two sentences, under 320 characters. " +
  "No hype, no buzzword soup, no emoji, no hashtags, no quotation marks, no preamble.";

async function trendFromLLM(candidates) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("no GITHUB_TOKEN");
  if (!candidates.length) throw new Error("no candidate headlines");

  const primary = candidates[0];
  const context = candidates
    .slice(0, 12)
    .map((c) => "- " + c.title)
    .join("\n");

  const userContent =
    "Write today's tech-trend nugget about this recent development:\n" +
    `"${primary.title}"\n\n` +
    "You may use these other recent headlines as background context, but keep " +
    "the nugget focused and self-contained (do not list them):\n" +
    context;

  const res = await fetch(API_URL, {
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
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });

  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { text: cleanText(data?.choices?.[0]?.message?.content), link: primary.url || "" };
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

async function buildFact(bank, recentFacts, entryCount) {
  try {
    const candidate = await factFromApi();
    if (isGoodFact(candidate, recentFacts)) return { text: candidate, source: "api" };
    throw new Error("low-quality fact: " + JSON.stringify(candidate));
  } catch (err) {
    console.warn("[nuggets] falling back to fact bank:", err.message);
    return { text: pickFromBank(bank.facts, recentFacts, entryCount), source: "bank" };
  }
}

async function buildTrend(bank, recentTrends, entryCount) {
  try {
    const candidates = await trendCandidates();
    const { text, link } = await trendFromLLM(candidates);
    if (isGoodTrend(text, recentTrends)) {
      const trend = { text, source: "llm" };
      if (link) trend.link = link;
      return trend;
    }
    throw new Error("low-quality trend: " + JSON.stringify(text));
  } catch (err) {
    console.warn("[nuggets] falling back to trend bank:", err.message);
    return { text: pickFromBank(bank.trends, recentTrends, entryCount), source: "bank" };
  }
}

async function main() {
  const store = await readJson(NUGGETS_PATH, { updated: "", entries: [] });
  if (!Array.isArray(store.entries)) store.entries = [];
  const bank = await readJson(BANK_PATH, { facts: [], trends: [] });

  const recentFacts = store.entries.map((e) => e.fact?.text).filter(Boolean);
  const recentTrends = store.entries.map((e) => e.trend?.text).filter(Boolean);
  const count = store.entries.length;

  const [fact, trend] = await Promise.all([
    buildFact(bank, recentFacts, count),
    buildTrend(bank, recentTrends, count),
  ]);

  const now = new Date();
  const date = todayUTC();
  const entry = { id: date, date, publishAt: publishAtFor(date), fact, trend };

  // replace same-id entry if re-run, else append; keep most recent KEEP
  store.entries = store.entries.filter((e) => e.id !== entry.id);
  store.entries.push(entry);
  store.entries.sort((a, b) => new Date(a.publishAt) - new Date(b.publishAt));
  store.entries = store.entries.slice(-KEEP);
  store.updated = now.toISOString();

  await writeFile(NUGGETS_PATH, JSON.stringify(store, null, 2) + "\n");
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

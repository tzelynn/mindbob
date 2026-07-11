// Generates ONE daily doodle prompt word and writes it to data/prompts.json.
//
//   node scripts/generate-prompt.mjs
//
// Primary source: GitHub Models (free, uses the Actions GITHUB_TOKEN).
// On any failure (no token, API error, low-quality output) it falls back to the
// curated WORDS list (shared with the frontend) so a fresh word ALWAYS lands.
// Runs once a day (AM cron); the word is identical AM -> PM.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WORDS } from "../js/prompts.js";
import { fetchWithRetry, planWork, isForced, LLM_TIMEOUT } from "./lib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROMPTS_PATH = join(ROOT, "data", "prompts.json");

const API_URL = "https://models.github.ai/inference/chat/completions";
const MODEL = "openai/gpt-4o-mini";
const KEEP = 14;

const SYSTEM_PROMPT =
  "You invent single-word doodle prompts for a calming daily drawing widget. " +
  "Output exactly ONE common, concrete, cheerful noun that's fun and easy to " +
  "sketch in 30 seconds with simple line art — think objects, animals, plants, " +
  "food, weather. Avoid abstract ideas, proper nouns, anything dark, complex " +
  "scenes, or multi-word answers. Surprise me with variety. " +
  "Reply with only the word, lowercase, no punctuation.";

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

// publish instant anchored to the date, NOT wall-clock now (mirrors the
// message generator), so the client selection is stable.
function publishAtFor(date) {
  return `${date}T00:00:00.000Z`;
}

function cleanWord(text) {
  if (!text) return "";
  let t = String(text).trim().toLowerCase();
  t = t.replace(/^[^a-z]+|[^a-z]+$/g, ""); // strip surrounding non-letters/quotes
  t = t.split(/\s+/)[0] || ""; // first token only
  return t;
}

function isGoodWord(w, recentWords) {
  if (!w) return false;
  if (!/^[a-z]{2,20}$/.test(w)) return false;
  if (recentWords.includes(w)) return false; // dedupe
  return true;
}

async function fromLLM(recentWords) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("no GITHUB_TOKEN");

  const avoid = recentWords.slice(-10);
  const userContent =
    "Give me today's doodle word." +
    (avoid.length ? " Do not use any of these recent words: " + avoid.join(", ") + "." : "");

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
        temperature: 0.9,
        max_tokens: 12,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
      }),
    },
    { timeoutMs: LLM_TIMEOUT },
  );

  const data = await res.json();
  return cleanWord(data?.choices?.[0]?.message?.content);
}

// Deterministic fallback: rotate through WORDS by entry count (no Math.random).
function fromBank(recentWords, entryCount) {
  const pool = WORDS.filter((w) => !recentWords.includes(w));
  const choices = pool.length ? pool : WORDS;
  return choices[entryCount % choices.length];
}

async function main() {
  const store = await readJson(PROMPTS_PATH, { updated: "", entries: [] });
  if (!Array.isArray(store.entries)) store.entries = [];
  const recentWords = store.entries.map((e) => e.word);

  const date = todayUTC();

  // Upgrade-only: skip when today's word already came from the LLM; a failed
  // retry keeps the existing entry instead of downgrading it (no write).
  const existing = store.entries.find((e) => e.id === date);
  const action = planWork(existing?.source, "llm", isForced());
  if (action === "skip") {
    console.log(`[prompt] ${date} already llm — skipping`);
    return;
  }

  let word = "";
  let source = "llm";
  try {
    const candidate = await fromLLM(recentWords);
    if (isGoodWord(candidate, recentWords)) {
      word = candidate;
    } else {
      throw new Error("low-quality output: " + JSON.stringify(candidate));
    }
  } catch (err) {
    if (action === "retry") {
      console.warn(`[prompt] retry failed, keeping existing ${existing.source} entry:`, err.message);
      return;
    }
    console.warn("[prompt] falling back to word list:", err.message);
    word = fromBank(recentWords, store.entries.length);
    source = "fallback";
  }

  const entry = { id: date, date, publishAt: publishAtFor(date), word, source };

  store.entries = store.entries.filter((e) => e.id !== entry.id);
  store.entries.push(entry);
  store.entries.sort((a, b) => new Date(a.publishAt) - new Date(b.publishAt));
  store.entries = store.entries.slice(-KEEP);
  store.updated = new Date().toISOString();

  await writeFile(PROMPTS_PATH, JSON.stringify(store, null, 2) + "\n");
  console.log(`[prompt] ${entry.id} (${source}): ${word}`);
}

// Run only when invoked directly, so tests can import this file safely.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

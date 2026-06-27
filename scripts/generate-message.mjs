// Generates one twice-daily message and appends it to data/messages.json.
//
//   node scripts/generate-message.mjs --slot=am|pm
//
// Primary source: GitHub Models (free, uses the Actions GITHUB_TOKEN).
// On any failure (no token, API error, low-quality output) it falls back to a
// hand-written line from data/fallback-bank.json so a fresh note ALWAYS lands.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MESSAGES_PATH = join(ROOT, "data", "messages.json");
const BANK_PATH = join(ROOT, "data", "fallback-bank.json");

const API_URL = "https://models.github.ai/inference/chat/completions";
const MODEL = "openai/gpt-4o-mini";
const MAX_LEN = 160;
const KEEP = 14;

const SLOT = (argOf("--slot") || "am").toLowerCase() === "pm" ? "pm" : "am";

const PROMPTS = {
  am:
    "Write ONE short feel-good note for someone starting their day. " +
    "Warm, lighthearted, encouraging, casual — like a friend texting you. " +
    "Never cheesy, never preachy, no hashtags, no emoji, no quotation marks. " +
    "One or two sentences, under 140 characters.",
  pm:
    "Write ONE short reflective note for someone winding down at the end of the day. " +
    "Gentle, calm, a little thoughtful, but still casual — like a friend texting you. " +
    "Never cheesy, never preachy, no hashtags, no emoji, no quotation marks. " +
    "One or two sentences, under 140 characters.",
};

function argOf(name) {
  const hit = process.argv.find((a) => a.startsWith(name + "="));
  return hit ? hit.slice(name.length + 1) : null;
}

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

// Each note's publish instant is anchored to its date + slot, NOT to the
// moment the script runs. This keeps AM strictly before PM (and ~12h apart)
// even when both slots are generated back-to-back, so the client always
// surfaces the right one. Hours are UTC.
const PUBLISH_HOUR_UTC = { am: 0, pm: 11 };
function publishAtFor(date, slot) {
  const hh = String(PUBLISH_HOUR_UTC[slot]).padStart(2, "0");
  return `${date}T${hh}:00:00.000Z`;
}

function clean(text) {
  if (!text) return "";
  let t = String(text).trim();
  t = t.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim(); // strip wrapping quotes
  t = t.replace(/\s+/g, " ");
  return t;
}

function isGoodMessage(t, recentTexts) {
  if (!t) return false;
  if (t.length < 8 || t.length > MAX_LEN) return false;
  if (/\bI (can't|cannot|won't|am unable)\b/i.test(t)) return false; // refusal
  if (recentTexts.includes(t)) return false; // dedupe
  return true;
}

async function fromLLM(recentTexts) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("no GITHUB_TOKEN");

  const avoid = recentTexts.slice(-6);
  const userContent =
    PROMPTS[SLOT] +
    (avoid.length
      ? "\n\nDo not repeat or closely echo any of these recent notes:\n- " +
        avoid.join("\n- ")
      : "");

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
      temperature: 0.85,
      max_tokens: 80,
      messages: [
        { role: "system", content: "You write tiny, sincere, casual notes. No preamble." },
        { role: "user", content: userContent },
      ],
    }),
  });

  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return clean(data?.choices?.[0]?.message?.content);
}

async function fromBank(recentTexts) {
  const bank = await readJson(BANK_PATH, { am: [], pm: [] });
  const pool = (bank[SLOT] || []).filter((t) => !recentTexts.includes(t));
  const choices = pool.length ? pool : bank[SLOT] || [];
  if (!choices.length) return "Take a slow breath. You showed up — that already counts.";
  // deterministic-ish pick without Math.random dependency: rotate by entry count
  const idx = recentTexts.length % choices.length;
  return choices[idx];
}

async function main() {
  const store = await readJson(MESSAGES_PATH, { updated: "", entries: [] });
  if (!Array.isArray(store.entries)) store.entries = [];
  const recentTexts = store.entries.map((e) => e.text);

  let text = "";
  let source = "llm";
  try {
    const candidate = await fromLLM(recentTexts);
    if (isGoodMessage(candidate, recentTexts)) {
      text = candidate;
    } else {
      throw new Error("low-quality output: " + JSON.stringify(candidate));
    }
  } catch (err) {
    console.warn("[generate] falling back to bank:", err.message);
    text = await fromBank(recentTexts);
    source = "fallback";
  }

  const now = new Date();
  const date = todayUTC();
  const entry = {
    id: `${date}-${SLOT}`,
    date,
    slot: SLOT,
    publishAt: publishAtFor(date, SLOT),
    text,
    source,
  };

  // replace same-id entry if re-run, else append; keep most recent KEEP
  store.entries = store.entries.filter((e) => e.id !== entry.id);
  store.entries.push(entry);
  store.entries.sort((a, b) => new Date(a.publishAt) - new Date(b.publishAt));
  store.entries = store.entries.slice(-KEEP);
  store.updated = now.toISOString();

  await writeFile(MESSAGES_PATH, JSON.stringify(store, null, 2) + "\n");
  console.log(`[generate] ${entry.id} (${source}): ${text}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

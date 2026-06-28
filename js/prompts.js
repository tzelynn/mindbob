// Daily doodle prompt: one single-word object, chosen deterministically
// from the date so everyone sees the same word on a given day (AM == PM) and it
// works offline. Same seeding pattern as palette.js / doodles.js — no Math.random.
import { hashString } from "./util.js";

// Curated simple, drawable single-word nouns.
export const WORDS = [
  "cat", "dog", "house", "tree", "flower", "sun", "moon", "star",
  "cloud", "boat", "car", "bus", "train", "plane", "bike", "fish",
  "bird", "frog", "bee", "snail", "butterfly", "cup", "mug", "teapot",
  "spoon", "fork", "hat", "shoe", "sock", "shirt", "umbrella", "key",
  "lamp", "candle", "clock", "book", "pencil", "brush", "kite", "balloon",
  "gift", "cake", "apple", "banana", "carrot", "mushroom", "leaf", "cactus",
  "palm", "anchor", "shell", "crab", "whale", "owl", "fox", "bear",
  "rabbit", "mouse", "ghost", "robot", "rocket", "planet", "mountain",
  "bridge", "tent", "guitar", "drum", "bell", "heart", "ladder",
];

// Pick one word for the given date seed (YYYY-MM-DD).
export function promptFor(dateSeed) {
  return WORDS[hashString("prompt|" + dateSeed) % WORDS.length];
}

// Select the current entry's word from data/prompts.json (greatest publishAt
// <= now), mirroring messages.js selection. Falls back to the deterministic
// date-seeded promptFor() when the file is missing/empty (offline, pre-cron).
export async function getCurrentPrompt(date, now = new Date()) {
  try {
    const res = await fetch("./data/prompts.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("prompts " + res.status);
    const data = await res.json();
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    if (!entries.length) throw new Error("no entries");
    const sorted = [...entries].sort(
      (a, b) => new Date(a.publishAt) - new Date(b.publishAt)
    );
    const nowMs = now.getTime();
    let chosen = null;
    for (const e of sorted) {
      if (new Date(e.publishAt).getTime() <= nowMs) chosen = e;
    }
    chosen = chosen || sorted[0];
    const word = chosen && typeof chosen.word === "string" ? chosen.word.trim() : "";
    if (!word) throw new Error("empty word");
    return word;
  } catch {
    return promptFor(date);
  }
}

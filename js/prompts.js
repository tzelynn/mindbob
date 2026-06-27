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

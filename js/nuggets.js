// Fetches the generated nuggets file and selects the entry to show now.
// The service worker serves a cached copy when offline. Selection reuses the
// same publishAt-based logic as the daily note (js/selectEntry.js).

import { pickCurrentEntry } from "./selectEntry.js";

const FALLBACK_NUGGETS = {
  id: "offline",
  date: "",
  publishAt: "1970-01-01T00:00:00Z",
  fact: {
    text: "Honey never really spoils — 3,000-year-old honey from Egyptian tombs is still edible.",
    source: "builtin",
  },
  trend: {
    text: "AI keeps getting smaller and faster — capable models now run right on phones and laptops, not just in the cloud.",
    source: "builtin",
  },
};

export async function loadNuggets() {
  try {
    const res = await fetch("./data/nuggets.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("nuggets " + res.status);
    const data = await res.json();
    if (!data || !Array.isArray(data.entries) || data.entries.length === 0) {
      throw new Error("no entries");
    }
    return data;
  } catch {
    return { updated: "", entries: [FALLBACK_NUGGETS] };
  }
}

// Pick the most recent entry whose publishAt is in the past; if every entry is
// in the future (freshly seeded data), show the oldest. Mirrors selectCurrent
// in js/messages.js.
export function selectCurrentNuggets(data, now = new Date()) {
  const chosen = pickCurrentEntry(data.entries, now.getTime());
  if (chosen) return chosen;
  const sorted = [...data.entries].sort(
    (a, b) => new Date(a.publishAt) - new Date(b.publishAt)
  );
  return sorted[0] || FALLBACK_NUGGETS;
}

export async function getCurrentNuggets(now = new Date()) {
  const data = await loadNuggets();
  return selectCurrentNuggets(data, now);
}

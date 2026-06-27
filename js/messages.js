// Fetches the generated message file and selects the entry to show now.
// The service worker serves a cached copy when offline.

const FALLBACK_ENTRY = {
  id: "offline",
  date: "",
  slot: "am",
  publishAt: "1970-01-01T00:00:00Z",
  text: "Take a slow breath. You showed up — that already counts.",
  source: "builtin",
};

export async function loadMessages() {
  try {
    const res = await fetch("./data/messages.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("messages " + res.status);
    const data = await res.json();
    if (!data || !Array.isArray(data.entries) || data.entries.length === 0) {
      throw new Error("no entries");
    }
    return data;
  } catch {
    return { updated: "", entries: [FALLBACK_ENTRY] };
  }
}

// Pick the most recent entry whose publishAt is in the past.
// If every entry is in the future (e.g. freshly seeded data), show the oldest.
export function selectCurrent(data, now = new Date()) {
  const entries = [...data.entries].sort(
    (a, b) => new Date(a.publishAt) - new Date(b.publishAt)
  );
  const nowMs = now.getTime();
  let chosen = null;
  for (const e of entries) {
    if (new Date(e.publishAt).getTime() <= nowMs) chosen = e;
  }
  return chosen || entries[0] || FALLBACK_ENTRY;
}

export async function getCurrentEntry(now = new Date()) {
  const data = await loadMessages();
  return selectCurrent(data, now);
}

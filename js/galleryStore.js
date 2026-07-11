// GALLERY store: past doodles kept as compressed image blobs in IndexedDB
// (localStorage only ever holds the current day — see doodleDecorate.js).
// All browser-API access happens inside functions and is guarded, so this
// module can be imported by Node for unit tests and degrades to no-ops when
// IndexedDB is unavailable (private mode, disabled storage).

const DB_NAME = "mindbob-gallery";
const DB_VERSION = 1;
const STORE = "doodles";
// Bound history like the mood tracker does (~2 years). Thumbnails are tens of
// KB, so even the full window is a few MB — well inside IndexedDB quotas.
const MAX_ENTRIES = 730;

function idb() {
  try {
    return globalThis.indexedDB || null;
  } catch {
    return null;
  }
}

function openDB() {
  return new Promise((resolve) => {
    const factory = idb();
    if (!factory) return resolve(null);
    let req;
    try {
      req = factory.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "date" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// entry: { date: "YYYY-MM-DD", blob: Blob, type: "image/webp|jpeg|png",
//          word: string, palette: {bg, ink, accent} }
// Returns true on success, null when storage is unavailable/failed.
export async function putEntry(entry) {
  const db = await openDB();
  if (!db) return null;
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    await requestToPromise(store.put(entry));
    // FIFO prune: dates sort lexicographically, so the oldest keys come first.
    const keys = await requestToPromise(store.getAllKeys());
    if (keys.length > MAX_ENTRIES) {
      keys.sort();
      for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) {
        await requestToPromise(store.delete(k));
      }
    }
    return true;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

// All entries, newest first. [] when storage is unavailable/failed.
export async function getAllEntries() {
  const db = await openDB();
  if (!db) return [];
  try {
    const tx = db.transaction(STORE, "readonly");
    const entries = await requestToPromise(tx.objectStore(STORE).getAll());
    return entries.sort((a, b) => (a.date < b.date ? 1 : -1));
  } catch {
    return [];
  } finally {
    db.close();
  }
}

export async function deleteEntry(date) {
  const db = await openDB();
  if (!db) return null;
  try {
    const tx = db.transaction(STORE, "readwrite");
    await requestToPromise(tx.objectStore(STORE).delete(date));
    return true;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

// ---------- pure helpers (unit-tested) ----------

// mindbob_<word>_<date>.<ext> — mirrors filename() in doodleDecorate.js; empty
// parts are dropped so a missing word never doubles the underscore.
export function galleryFilename(word, date, type) {
  const ext =
    type === "image/webp" ? "webp" : type === "image/jpeg" ? "jpg" : "png";
  return ["mindbob", word, date].filter(Boolean).join("_") + "." + ext;
}

// The localStorage doodle keys belonging to PAST days — the ones to archive
// before the per-day prune drops them. `today` is the current entry date.
export function staleKeys(keys, prefix, today) {
  return keys.filter((k) => k && k.startsWith(prefix) && k !== prefix + today);
}

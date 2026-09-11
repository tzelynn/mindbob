import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// sw.js is a classic worker script, so it is evaluated here inside a stubbed
// worker global instead of imported. The harness returns the periodicsync
// handler plus whatever the run notified about.
async function loadSw({ nuggets, lastNotified = null, ok = true }) {
  const src = await readFile(new URL("../sw.js", import.meta.url), "utf8");

  const meta = new Map();
  if (lastNotified) meta.set("https://mindbob.local/last-notified", lastNotified);
  const shown = [];
  const listeners = new Map();

  const self = {
    addEventListener: (type, fn) => listeners.set(type, fn),
    location: { origin: "https://example.test" },
    skipWaiting: () => {},
    clients: { matchAll: async () => [], openWindow: async () => {} },
    registration: {
      scope: "https://example.test/mindbob/",
      showNotification: async (title, opts) => shown.push({ title, ...opts }),
    },
  };
  const caches = {
    open: async () => ({
      match: async (key) =>
        meta.has(key) ? { text: async () => meta.get(key) } : undefined,
      put: async (key, res) => meta.set(key, await res.text()),
    }),
    keys: async () => [],
    delete: async () => true,
  };
  const requested = [];
  const fetchStub = async (url) => {
    requested.push(url);
    return { ok, json: async () => nuggets };
  };
  const ResponseStub = class {
    constructor(body) { this.body = String(body); }
    async text() { return this.body; }
  };

  // `listeners` is populated through the stubbed self.addEventListener above.
  new Function("self", "caches", "fetch", "Response", src)(
    self,
    caches,
    fetchStub,
    ResponseStub
  );

  const handler = listeners.get("periodicsync");
  assert.ok(handler, "sw.js must register a periodicsync handler");
  const waits = [];
  await handler({ tag: "mindbob-check", waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return { shown, requested, meta };
}

const entries = [
  {
    id: "2026-09-10",
    date: "2026-09-10",
    publishAt: "2026-09-10T00:00:00Z",
    fact: { text: "Yesterday's fact.", source: "api" },
    trend: { text: "Yesterday's trend.", source: "llm" },
  },
  {
    id: "2026-09-11",
    date: "2026-09-11",
    publishAt: "2026-09-11T00:00:00Z",
    fact: { text: "Honey never really spoils.", source: "api" },
    trend: { text: "Models keep shrinking.", source: "llm" },
  },
];

test("notifies with the current entry's fun fact, not the trend", async () => {
  const { shown, requested } = await loadSw({ nuggets: { entries } });
  assert.equal(requested[0], "./data/nuggets.json");
  assert.equal(shown.length, 1);
  assert.equal(shown[0].body, "Honey never really spoils.");
  assert.match(shown[0].title, /fun fact/);
});

test("does not re-notify for an entry already notified", async () => {
  const { shown } = await loadSw({ nuggets: { entries }, lastNotified: "2026-09-11" });
  assert.deepEqual(shown, []);
});

test("records the notified id so the next run dedupes", async () => {
  const { meta } = await loadSw({ nuggets: { entries } });
  assert.equal(meta.get("https://mindbob.local/last-notified"), "2026-09-11");
});

test("stays silent when the entry has no fact text", async () => {
  const stripped = entries.map((e) => ({ ...e, fact: { source: "api" } }));
  const { shown, meta } = await loadSw({ nuggets: { entries: stripped } });
  assert.deepEqual(shown, []);
  // and must not burn the dedupe id on a no-op run
  assert.equal(meta.get("https://mindbob.local/last-notified"), undefined);
});

test("stays silent when the fetch fails", async () => {
  const { shown } = await loadSw({ nuggets: { entries }, ok: false });
  assert.deepEqual(shown, []);
});

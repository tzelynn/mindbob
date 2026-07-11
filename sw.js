// mindbob service worker.
// - App shell: cache-first (instant load, works offline).
// - data/messages.json: network-first with cache fallback (fresh when online,
//   last note when offline).
// - everything else (doodles, etc.): stale-while-revalidate.
//
// Update safety: every cache read/write is scoped to THIS version's caches
// (never the global `caches.match`, which spans all versions). Combined with
// not calling `clients.claim()`, this guarantees a page is always served a
// single self-consistent snapshot — one SW version per navigation — so an
// in-flight update can never mix an old index.html with a new main.js (which
// would crash init: stale element ids -> null refs). `skipWaiting` still makes
// the new version take over on the next reload.

const VERSION = "v10";
const SHELL_CACHE = `mindbob-shell-${VERSION}`;
const RUNTIME_CACHE = `mindbob-runtime-${VERSION}`;
// Unversioned: holds the id of the last note we notified about. Must survive
// version bumps, so it is excluded from the activate() cleanup below.
const META_CACHE = "mindbob-meta";
const LAST_NOTIFIED_KEY = "https://mindbob.local/last-notified";
const PERIODIC_TAG = "mindbob-check";

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./assets/fonts/Eggi-Regular.ttf",
  "./js/main.js",
  "./js/modes.js",
  "./js/messages.js",
  "./js/selectEntry.js",
  "./js/palette.js",
  "./js/doodles.js",
  "./js/messageDecorate.js",
  "./js/doodleDecorate.js",
  "./js/galleryStore.js",
  "./js/galleryView.js",
  "./js/nuggets.js",
  "./js/nuggetsDecorate.js",
  "./js/mood.js",
  "./js/moodDecorate.js",
  "./js/brain.js",
  "./js/brainDecorate.js",
  "./js/prompts.js",
  "./js/util.js",
  "./js/pwa.js",
  "./js/notify.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // addAll fails the whole install if any 404s; add individually instead.
      .then((cache) => Promise.allSettled(SHELL_ASSETS.map((a) => cache.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  // Drop caches from older versions. We deliberately do NOT call
  // clients.claim() — claiming swaps the controller mid-load and can serve a
  // page a mix of old + new assets. Without it, the running page keeps its
  // version until the next reload, when the new SW serves a clean snapshot.
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE && k !== META_CACHE
            )
            .map((k) => caches.delete(k))
        )
      )
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Messages: network-first.
  if (url.pathname.endsWith("/data/messages.json")) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Doodle prompt: network-first (fresh when online, last word offline).
  if (url.pathname.endsWith("/data/prompts.json")) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Nuggets: network-first (fresh when online, last nuggets offline).
  if (url.pathname.endsWith("/data/nuggets.json")) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Doodle manifest changes when doodles are added: stale-while-revalidate.
  if (url.pathname.endsWith("/doodles/index.json")) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Same-origin assets: cache-first, then runtime-cache.
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
    return;
  }
});

async function cacheFirst(request) {
  // Scope to this version's caches so the shell stays self-consistent during
  // an update (the global caches.match would span versions and could mix them).
  const shell = await caches.open(SHELL_CACHE);
  const cachedShell = await shell.match(request);
  if (cachedShell) return cachedShell;

  const runtime = await caches.open(RUNTIME_CACHE);
  const cachedRuntime = await runtime.match(request);
  if (cachedRuntime) return cachedRuntime;

  try {
    const res = await fetch(request);
    if (res.ok) runtime.put(request, res.clone());
    return res;
  } catch {
    return Response.error();
  }
}

async function networkFirst(request) {
  const runtime = await caches.open(RUNTIME_CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) runtime.put(request, res.clone());
    return res;
  } catch {
    const cached = await runtime.match(request);
    return cached || Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const runtime = await caches.open(RUNTIME_CACHE);
  const cached = await runtime.match(request);
  const fetching = fetch(request)
    .then((res) => {
      if (res.ok) runtime.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  return cached || (await fetching) || Response.error();
}

// >>> selection-parity >>>
// EXACT copy of pickCurrentEntry from js/selectEntry.js. This is a classic
// worker and cannot import ES modules; test/sw-selection.test.mjs asserts the
// two stay identical in behavior. If you change one, change the other.
function pickCurrentEntry(entries, nowMs) {
  let chosen = null;
  let chosenMs = -Infinity;
  for (const e of entries) {
    const t = new Date(e.publishAt).getTime();
    if (t <= nowMs && t >= chosenMs) {
      chosen = e;
      chosenMs = t;
    }
  }
  return chosen;
}
// <<< selection-parity <<<

async function getLastNotifiedId() {
  try {
    const cache = await caches.open(META_CACHE);
    const res = await cache.match(LAST_NOTIFIED_KEY);
    return res ? await res.text() : null;
  } catch {
    return null;
  }
}

async function setLastNotifiedId(id) {
  try {
    const cache = await caches.open(META_CACHE);
    await cache.put(LAST_NOTIFIED_KEY, new Response(id));
  } catch {
    /* storage unavailable — degrade silently */
  }
}

function titleFor() {
  return "mindbob · today's note";
}

// Fetch the latest notes, pick the current one, and notify if it's new.
async function checkForNewNote() {
  let data;
  try {
    const res = await fetch("./data/messages.json", { cache: "no-store" });
    if (!res.ok) return;
    data = await res.json();
  } catch {
    return;
  }
  if (!data || !Array.isArray(data.entries)) return;

  const entry = pickCurrentEntry(data.entries, Date.now());
  if (!entry) return;

  const last = await getLastNotifiedId();
  if (entry.id === last) return;

  await setLastNotifiedId(entry.id);
  await self.registration.showNotification(titleFor(entry), {
    body: entry.text,
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    tag: "mindbob-note",
    data: { url: self.registration.scope },
  });
}

self.addEventListener("periodicsync", (event) => {
  if (event.tag === PERIODIC_TAG) {
    event.waitUntil(checkForNewNote());
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url =
    (event.notification.data && event.notification.data.url) ||
    self.registration.scope;
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of all) {
        if ("focus" in client) {
          await client.focus();
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(url);
    })()
  );
});

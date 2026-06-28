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

const VERSION = "v5";
const SHELL_CACHE = `mindbob-shell-${VERSION}`;
const RUNTIME_CACHE = `mindbob-runtime-${VERSION}`;

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./assets/fonts/Eggi-Regular.ttf",
  "./js/main.js",
  "./js/messages.js",
  "./js/palette.js",
  "./js/doodles.js",
  "./js/messageDecorate.js",
  "./js/doodleDecorate.js",
  "./js/prompts.js",
  "./js/util.js",
  "./js/pwa.js",
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
            .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
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

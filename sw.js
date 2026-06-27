// mindbob service worker.
// - App shell: cache-first (instant load, works offline).
// - data/messages.json: network-first with cache fallback (fresh when online,
//   last note when offline).
// - everything else (doodles, etc.): stale-while-revalidate.

const VERSION = "v1";
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
  "./js/autoDecorate.js",
  "./js/customDecorate.js",
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
      .then(() => self.clients.claim())
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
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res.ok) (await caches.open(RUNTIME_CACHE)).put(request, res.clone());
    return res;
  } catch {
    return cached || Response.error();
  }
}

async function networkFirst(request) {
  try {
    const res = await fetch(request);
    if (res.ok) (await caches.open(RUNTIME_CACHE)).put(request, res.clone());
    return res;
  } catch {
    const cached = await caches.match(request);
    return cached || Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const fetching = fetch(request)
    .then((res) => {
      if (res.ok) caches.open(RUNTIME_CACHE).then((c) => c.put(request, res.clone()));
      return res;
    })
    .catch(() => null);
  return cached || (await fetching) || Response.error();
}

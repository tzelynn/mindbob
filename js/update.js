// "Update" button: pull the newest deploy into an already-installed PWA.
//
// An installed mindbob is served by sw.js from a *versioned* cache, so a phone
// can keep showing an old build long after Pages has redeployed. This button
// makes the refresh explicit:
//   1. registration.update() re-fetches sw.js (browsers bypass the HTTP cache
//      for the SW script), so a bumped VERSION installs a fresh shell cache.
//      sw.js already calls skipWaiting(), so the new worker activates on its
//      own and controls the next navigation — we just wait, then reload.
//   2. If sw.js is byte-identical there is no new worker, yet other assets may
//      still have changed. Then we purge the versioned caches ourselves (from
//      the page — CacheStorage is same-origin, no message plumbing needed) so
//      the reload refetches everything from the network.
// The unversioned meta cache is never purged: it holds the last-notified id
// (see sw.js), which must survive updates or the next check re-notifies.

const META_CACHE = "mindbob-meta";
const WAIT_MS = 20000;

function toast(status, text) {
  if (!status) return;
  status.textContent = text;
  status.classList.add("is-toast");
}

// Resolve once the freshly-found worker has finished installing/activating.
function settled(worker) {
  if (worker.state === "activated" || worker.state === "redundant") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const onState = () => {
      if (worker.state === "activated" || worker.state === "redundant") {
        worker.removeEventListener("statechange", onState);
        resolve();
      }
    };
    worker.addEventListener("statechange", onState);
  });
}

// Returns true when a new service worker version was found and installed.
async function pullNewWorker(reg) {
  await reg.update();
  const worker = reg.installing || reg.waiting;
  if (!worker) return false;
  await settled(worker);
  return true;
}

async function purgeCaches() {
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k !== META_CACHE).map((k) => caches.delete(k))
    );
  } catch {
    /* storage unavailable — the reload still hits the network for misses */
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

export function initUpdate(btn, status) {
  if (!btn) return;
  if (!("serviceWorker" in navigator) || !("caches" in window)) {
    btn.hidden = true; // nothing cached to refresh from
    return;
  }
  btn.hidden = false;

  btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.classList.add("is-busy");
    toast(status, "checking for updates…");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const found = reg ? await withTimeout(pullNewWorker(reg), WAIT_MS) : false;
      if (found) {
        toast(status, "new version — reloading…");
      } else {
        toast(status, "refreshing…");
        await purgeCaches();
      }
    } catch {
      await purgeCaches(); // best effort: reload from the network anyway
    } finally {
      location.reload();
    }
  });
}

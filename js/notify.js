// Opt-in background notifications for newly published notes.
// Shows a bell toggle ONLY where Periodic Background Sync can deliver
// (Chromium + installed PWA); hidden everywhere else, so the bell always means
// real background push. See sw.js for the periodicsync handler and
// docs/superpowers/specs/2026-06-28-push-notifications-design.md for rationale.

const PERIODIC_TAG = "mindbob-check";
const MIN_INTERVAL = 12 * 60 * 60 * 1000;
// Shared with sw.js — keep in sync.
const META_CACHE = "mindbob-meta";
const LAST_NOTIFIED_KEY = "https://mindbob.local/last-notified";

function supported() {
  return (
    "serviceWorker" in navigator &&
    "Notification" in window &&
    "PeriodicSyncManager" in window
  );
}

async function setLastNotifiedId(id) {
  try {
    const cache = await caches.open(META_CACHE);
    await cache.put(LAST_NOTIFIED_KEY, new Response(id));
  } catch {
    /* storage unavailable — degrade silently */
  }
}

async function isEnabled(reg) {
  if (Notification.permission !== "granted") return false;
  try {
    const tags = await reg.periodicSync.getTags();
    return tags.includes(PERIODIC_TAG);
  } catch {
    return false;
  }
}

function reflect(bell, on) {
  bell.classList.toggle("is-active", on);
  bell.setAttribute("aria-pressed", String(on));
  const label = on ? "Notifications on — tap to turn off" : "Notify me of new notes";
  bell.setAttribute("aria-label", label);
  bell.title = label;
}

async function enable(reg, currentId) {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return;
  try {
    await reg.periodicSync.register(PERIODIC_TAG, { minInterval: MIN_INTERVAL });
  } catch {
    return; // browser refused (e.g. insufficient site engagement)
  }
  // Seed so the first check doesn't notify for the note already on screen.
  await setLastNotifiedId(currentId);
}

async function disable(reg) {
  try {
    await reg.periodicSync.unregister(PERIODIC_TAG);
  } catch {
    /* ignore */
  }
}

export async function initNotifications(bell, state) {
  if (!bell || !supported()) return; // bell stays hidden via the [hidden] attr

  const reg = await navigator.serviceWorker.ready;
  bell.hidden = false;
  reflect(bell, await isEnabled(reg));

  bell.addEventListener("click", async () => {
    if (!state.entry) return;
    bell.disabled = true;
    try {
      if (await isEnabled(reg)) {
        await disable(reg);
      } else {
        await enable(reg, state.entry.id);
      }
      reflect(bell, await isEnabled(reg));
    } finally {
      bell.disabled = false;
    }
  });
}

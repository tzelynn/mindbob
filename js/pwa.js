// Registers the service worker (no-op on http: file previews without SW support).
export function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      /* offline support is a progressive enhancement; ignore failures */
    });
  });
}

// Registers the service worker (no-op on http: file previews without SW support).
export function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  const register = () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      /* offline support is a progressive enhancement; ignore failures */
    });
  };
  // registerSW() is called from the tail of main.js's async init(), which
  // awaits network fetches — by then `load` has almost always already fired,
  // and a listener added afterwards never runs (the SW then never registers,
  // killing offline caching AND the notification bell, which waits on
  // navigator.serviceWorker.ready). So register right away when the document
  // is already done loading.
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}

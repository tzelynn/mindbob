import test from "node:test";
import assert from "node:assert/strict";

// registerSW() runs from the tail of main.js's async init(), long after the
// document has finished loading — so it must not wait for a `load` event that
// already fired. If it does, the SW never registers and the notification bell
// (which awaits navigator.serviceWorker.ready) stays hidden forever.
async function runRegisterSW(readyState) {
  const calls = { registered: [], listeners: [] };
  // Node exposes `navigator` as a getter-only global, so redefine it.
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      serviceWorker: {
        register(path) {
          calls.registered.push(path);
          return Promise.resolve({});
        },
      },
    },
  });
  globalThis.document = { readyState };
  globalThis.window = {
    addEventListener(type, fn) {
      calls.listeners.push(type);
      fn();
    },
  };
  const { registerSW } = await import(`../js/pwa.js?${readyState}`);
  registerSW();
  return calls;
}

test("registers immediately when the document has already loaded", async () => {
  const calls = await runRegisterSW("complete");
  assert.deepEqual(calls.registered, ["./sw.js"]);
  assert.deepEqual(calls.listeners, []);
});

test("waits for load when the document is still loading", async () => {
  const calls = await runRegisterSW("loading");
  assert.deepEqual(calls.listeners, ["load"]);
  assert.deepEqual(calls.registered, ["./sw.js"]);
});

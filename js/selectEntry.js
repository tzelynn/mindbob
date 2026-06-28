// Single source of truth for "which note is current".
// Pure: no DOM, no fetch, no service-worker globals — so it can be imported by
// js/messages.js (page) AND unit-tested in Node. sw.js keeps a byte-identical
// copy (it is a classic worker and cannot import ES modules); test/sw-selection
// .test.mjs asserts the two stay in parity.
//
// Returns the entry with the greatest publishAt that is <= nowMs, or null if no
// entry has been published yet.
export function pickCurrentEntry(entries, nowMs) {
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

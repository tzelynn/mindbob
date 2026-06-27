// Small shared helpers: deterministic hashing + seeded PRNG.
// Same seed string -> same sequence, so a message always looks identical.

// FNV-1a 32-bit string hash.
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32 PRNG -> function returning floats in [0, 1).
export function rng(seedInt) {
  let a = seedInt >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Make a seeded RNG directly from a string seed.
export function seededRng(seedStr) {
  return rng(hashString(seedStr));
}

// Pick an element from arr using a hash of seedStr (stable, no RNG state).
export function pick(arr, seedStr, salt = "") {
  if (!arr || arr.length === 0) return undefined;
  return arr[hashString(seedStr + "|" + salt) % arr.length];
}

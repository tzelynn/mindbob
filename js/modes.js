// The ordered list of display modes — the single source of truth shared by the
// mode menu, swipe navigation, and hash parsing. Pure module (no DOM) so it is
// unit-testable in Node.

export const MODES = ["nuggets", "brain", "mood", "doodle"];

export function isMode(m) {
  return MODES.includes(m);
}

// dir: -1 (previous) | +1 (next). Cyclical: past the last mode the move wraps
// round to the first (and vice versa), so swiping keeps carrying you through
// the modes instead of dead-ending.
export function nextMode(mode, dir) {
  const i = MODES.indexOf(mode);
  if (i < 0) return null;
  const n = MODES.length;
  return MODES[(((i + dir) % n) + n) % n];
}

// Classify a completed pointer gesture: -1 (go to previous mode), 0 (not a
// swipe), +1 (go to next mode). Swiping left (dx < 0) advances to the NEXT
// mode — carousel semantics. A gesture must be long enough (minDx) and
// clearly horizontal (|dx| > ratio * |dy|) to count.
export function resolveSwipe(dx, dy, { minDx = 48, ratio = 1.4 } = {}) {
  if (Math.abs(dx) < minDx || Math.abs(dx) < ratio * Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}

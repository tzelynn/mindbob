// The ordered list of display modes — the single source of truth shared by the
// mode menu, swipe navigation, and hash parsing. Pure module (no DOM) so it is
// unit-testable in Node.

export const MODES = ["message", "doodle", "nuggets", "mood", "brain"];

export function isMode(m) {
  return MODES.includes(m);
}

// dir: -1 (previous) | +1 (next). No wrap-around: at either end the move is a
// no-op (null) — accidental over-swipes shouldn't jump to the far side.
export function nextMode(mode, dir) {
  const i = MODES.indexOf(mode);
  if (i < 0) return null;
  const j = i + dir;
  return j >= 0 && j < MODES.length ? MODES[j] : null;
}

// Classify a completed pointer gesture: -1 (go to previous mode), 0 (not a
// swipe), +1 (go to next mode). Swiping left (dx < 0) advances to the NEXT
// mode — carousel semantics. A gesture must be long enough (minDx) and
// clearly horizontal (|dx| > ratio * |dy|) to count.
export function resolveSwipe(dx, dy, { minDx = 48, ratio = 1.4 } = {}) {
  if (Math.abs(dx) < minDx || Math.abs(dx) < ratio * Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}

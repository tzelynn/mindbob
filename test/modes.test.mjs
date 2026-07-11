import test from "node:test";
import assert from "node:assert/strict";

import { MODES, isMode, nextMode, resolveSwipe } from "../js/modes.js";

test("MODES lists the five modes in display order", () => {
  assert.deepEqual(MODES, ["message", "doodle", "nuggets", "mood", "brain"]);
});

test("isMode accepts known modes and rejects everything else", () => {
  for (const m of MODES) assert.equal(isMode(m), true);
  assert.equal(isMode("gallery"), false);
  assert.equal(isMode(""), false);
  assert.equal(isMode(undefined), false);
});

test("nextMode steps through the order", () => {
  assert.equal(nextMode("message", 1), "doodle");
  assert.equal(nextMode("doodle", 1), "nuggets");
  assert.equal(nextMode("nuggets", -1), "doodle");
  assert.equal(nextMode("mood", 1), "brain");
});

test("nextMode does not wrap at the ends", () => {
  assert.equal(nextMode("message", -1), null);
  assert.equal(nextMode("brain", 1), null);
});

test("nextMode returns null for unknown modes", () => {
  assert.equal(nextMode("bogus", 1), null);
  assert.equal(nextMode(undefined, -1), null);
});

test("resolveSwipe requires a long enough horizontal move", () => {
  assert.equal(resolveSwipe(-47, 0), 0); // just under minDx
  assert.equal(resolveSwipe(-48, 0), 1);
  assert.equal(resolveSwipe(48, 0), -1);
  assert.equal(resolveSwipe(0, 0), 0);
});

test("resolveSwipe rejects diagonal/vertical gestures", () => {
  // |dx| must exceed ratio * |dy| (default 1.4)
  assert.equal(resolveSwipe(60, 50), 0);
  assert.equal(resolveSwipe(-60, 50), 0);
  assert.equal(resolveSwipe(80, 50), -1); // 80 > 1.4*50
});

test("resolveSwipe direction: swipe left advances, swipe right goes back", () => {
  assert.equal(resolveSwipe(-100, 5), 1);
  assert.equal(resolveSwipe(100, 5), -1);
});

test("resolveSwipe honours custom thresholds", () => {
  assert.equal(resolveSwipe(-30, 0, { minDx: 24 }), 1);
  assert.equal(resolveSwipe(-60, 50, { ratio: 1 }), 1);
});

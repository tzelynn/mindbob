import test from "node:test";
import assert from "node:assert/strict";

import { galleryFilename, staleKeys } from "../js/galleryStore.js";

test("galleryFilename derives the extension from the blob type", () => {
  assert.equal(
    galleryFilename("feather", "2026-07-10", "image/webp"),
    "mindbob_feather_2026-07-10.webp"
  );
  assert.equal(
    galleryFilename("feather", "2026-07-10", "image/jpeg"),
    "mindbob_feather_2026-07-10.jpg"
  );
  assert.equal(
    galleryFilename("feather", "2026-07-10", "image/png"),
    "mindbob_feather_2026-07-10.png"
  );
  // unknown/missing type degrades to png
  assert.equal(
    galleryFilename("feather", "2026-07-10", undefined),
    "mindbob_feather_2026-07-10.png"
  );
});

test("galleryFilename drops empty parts (no doubled underscore)", () => {
  assert.equal(
    galleryFilename("", "2026-07-10", "image/webp"),
    "mindbob_2026-07-10.webp"
  );
  assert.equal(galleryFilename("", "", "image/png"), "mindbob.png");
});

test("staleKeys picks prefix-matching keys that are not today's", () => {
  const keys = [
    "mindbob:doodle:2026-07-09",
    "mindbob:doodle:2026-07-10",
    "mindbob:mood:2026-07-09",
    "mindbob:brain:monthly",
    "unrelated",
    null,
  ];
  assert.deepEqual(staleKeys(keys, "mindbob:doodle:", "2026-07-10"), [
    "mindbob:doodle:2026-07-09",
  ]);
});

test("staleKeys returns empty when only today's key exists", () => {
  assert.deepEqual(
    staleKeys(["mindbob:doodle:2026-07-10"], "mindbob:doodle:", "2026-07-10"),
    []
  );
});

test("galleryStore is importable without browser APIs", async () => {
  // Node has no indexedDB; the store must degrade instead of throwing.
  const { putEntry, getAllEntries, deleteEntry } = await import(
    "../js/galleryStore.js"
  );
  assert.equal(await putEntry({ date: "2026-07-09" }), null);
  assert.deepEqual(await getAllEntries(), []);
  assert.equal(await deleteEntry("2026-07-09"), null);
});

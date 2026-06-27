# Persist custom decorations + descriptive save filename

**Date:** 2026-06-27
**Scope:** `js/customDecorate.js` only. No changes to `main.js`, `messages.js`, or `palette.js`.

## Goals

1. **Persist custom decorations per message across reloads.** After closing the
   site/PWA and reopening, the user's drawing and message position for the
   current note are restored. The decoration resets only when the note itself
   refreshes (new `entry.id`).
2. **Descriptive, unique save filename.** Saved images download as
   `mindbob_<theme>_<date>_<slot>.png` (e.g. `mindbob_sand_2026-06-27_am.png`),
   unique per message, with `<theme>` being the concise one-word palette name.

## Background

`customDecorate.js` holds all decorate-mode state in memory:

- the `<canvas>` pixels (free-drawing), and
- `msgX` / `msgY` — the message DOM node's translate offsets.

Nothing is persisted, so a reload loses everything. `save()` currently hardcodes
the download name `"mindbob.png"`.

The palette (`palette.js`) already exposes a concise one-word `name`
(sand / sage / mist / blush / lavender / dusk / clay / sea), derived
deterministically from `entry.id`. The entry (`messages.js`) exposes `id`,
`date` (`YYYY-MM-DD`), and `slot` (`am|pm`).

## Design

### 1. Persistence

A small `localStorage`-backed helper inside `createCustomDecorator`, keyed by the
current note's `entry.id`.

- **Key:** `mindbob:decoration:<entry.id>` (prefix constant `STORE_PREFIX =
  "mindbob:decoration:"`).
- **Payload:** `{ img: canvas.toDataURL("image/png"), msgX, msgY }`. Canvas
  dataURL is the zero-dependency vanilla fit; a single phone-sized PNG is well
  within the ~5MB `localStorage` budget.
- **`persist()`** — write the payload for the current `entry.id`, then **prune**
  every other `mindbob:decoration:*` key so only the current note's decoration is
  retained. Pruning is what enforces "refresh only when the message refreshes": a
  new `entry.id` has no saved state, and the stale one is removed. Wrap reads and
  writes in `try/catch` so a disabled/full `localStorage` degrades to in-memory
  behaviour rather than throwing.
- **When to call `persist()`:** at the end of each completed mutating action —
  `onCanvasUp` (stroke/erase finished), `onMsgUp` (drag finished), `clearDrawing`,
  and `undo`.
- **Restore:** in `activate()`, after `fitCanvas()`, read the payload for
  `entry.id`. If present:
  - set `msgX` / `msgY` from the payload, then `applyMsgTransform()`;
  - load `img` into an `Image` and `drawImage` it scaled to the current canvas
    CSS size (so DPR/resize/orientation differences are absorbed). Because image
    decode is async, draw on the image's `onload`; the canvas is already cleared
    by `fitCanvas` on a fresh entry so there is no flash of stale content.

Decorations are visible only in decorate mode (auto mode hides the canvas via
CSS), so lazy restore on `activate()` is sufficient — no work needed in auto mode
or in `main.js`.

### 2. Save filename

In `save()`, replace `a.download = "mindbob.png"` with a derived name:

```
mindbob_<palette.name>_<date>_<slot>.png
```

Built from `state.palette.name`, `state.entry.date`, `state.entry.slot`. Guard
against the offline/builtin fallback entry (which has `date: ""`): filter out
empty parts before joining with `_` so an empty date can't produce a double
underscore. Example outputs:

- `mindbob_sand_2026-06-27_am.png`
- `mindbob_mist_2026-06-27_pm.png`
- `mindbob_sand_am.png` (offline fallback, empty date dropped)

## Out of scope (YAGNI)

- No IndexedDB, no Blob storage.
- No multi-message gallery or history.
- No settings/preferences UI.
- No changes outside `customDecorate.js`.

## Verification

- Draw in decorate mode, reload → drawing and message position restored.
- Move the message, reload → position restored.
- Wait for / simulate a new note (`entry.id` change) → decoration resets and the
  old key is pruned from `localStorage`.
- Save → downloaded file is named `mindbob_<theme>_<date>_<slot>.png`.
- Disable `localStorage` (or fill it) → decorate mode still works in-memory, no
  thrown errors.

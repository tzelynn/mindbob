# LLM-generated daily doodle prompt — design

## Goal

Make the daily doodle prompt word LLM-generated via GitHub Actions, mirroring the
existing message pipeline, instead of being a static date-seeded pick from a
curated word list. Keep the word-list pick as the deterministic offline fallback.

## Constraints (inherited from CLAUDE.md)

- No framework / no build step / no npm deps for the site.
- All paths relative (`./data/...`, `./js/...`).
- Cron uses only the built-in `GITHUB_TOKEN` (`models: read` + `contents: write`).
- Deterministic-per-day fallback (no `Math.random`).
- Preserve the **AM == PM doodle word** invariant: the prompt word is identical
  all day; only the message changes between AM and PM.

## Decisions

- **Frequency:** generate one word per day, on the AM cron run only.
- **Storage:** new separate file `data/prompts.json` with its own contract.
- **Fallback:** reuse the existing `WORDS` list / `promptFor()` deterministic pick
  (mirrors the message's `fallback-bank` pattern); frontend also falls back to it
  when the fetch fails offline.

## Components

### 1. `scripts/generate-prompt.mjs` (new)

Modeled on `scripts/generate-message.mjs`.

- Reads existing `data/prompts.json` (default `{ updated: "", entries: [] }`).
- Builds `recentWords` from existing entries (for dedupe / avoid-list).
- `fromLLM(recentWords)`:
  - Throws if no `GITHUB_TOKEN`.
  - POSTs to `https://models.github.ai/inference/chat/completions`,
    model `openai/gpt-4o-mini`, same headers as the message generator.
  - System prompt (creative single-word doodle subjects):
    > "You invent single-word doodle prompts for a calming daily drawing widget.
    > Output exactly ONE common, concrete, cheerful noun that's fun and easy to
    > sketch in 30 seconds with simple line art — think objects, animals, plants,
    > food, weather. Avoid abstract ideas, proper nouns, anything dark, complex
    > scenes, or multi-word answers. Surprise me with variety. Reply with only the
    > word, lowercase, no punctuation."
  - User message appends the recent words to avoid (last ~10), when present.
  - `temperature` ~0.9, small `max_tokens`.
- `cleanWord(text)`: trim, lowercase, strip surrounding quotes/punctuation, take the
  first token if the model returns more than one word.
- `isGoodWord(w, recentWords)`: non-empty; matches `^[a-z]{2,20}$`; not a refusal;
  not already in `recentWords`.
- On any failure → `fromBank`-style fallback: deterministic pick from `WORDS`
  rotated by entry count (no `Math.random`). `WORDS` is imported from
  `../js/prompts.js` (single source of truth) or duplicated in the script — see
  Open question below; default is to import to avoid drift.
- Writes an entry, dedupes by `id`, sorts by `publishAt`, keeps last `KEEP` (14),
  stamps `updated`.

`publishAt` derived deterministically from date (`YYYY-MM-DDT00:00:00.000Z`), NOT
wall-clock now — same rationale as the message generator.

### 2. `data/prompts.json` (new contract)

```json
{ "updated": "ISO", "entries": [
  { "id": "YYYY-MM-DD", "date": "YYYY-MM-DD",
    "publishAt": "YYYY-MM-DDT00:00:00.000Z", "word": "feather",
    "source": "llm|fallback|seed" } ] }
```

- One entry per day (no `slot`); `id` == `date`.
- Client shows the entry with the greatest `publishAt` that is `<= now`.
- Seed the repo with an initial entry so the site works before the first cron run.

### 3. `js/prompts.js` (extend)

- Keep `WORDS` and `promptFor(dateSeed)` unchanged (offline deterministic fallback).
- Add `async getCurrentPrompt(date, now = new Date())`:
  - `fetch("./data/prompts.json", { cache: "no-cache" })`.
  - Select current entry (greatest `publishAt <= now`; else oldest).
  - Return its `word`.
  - On any error / no usable entry → return `promptFor(date)`.

### 4. `js/main.js` (one-line change)

- Line 41: `state.promptWord = promptFor(state.entry.date)`
  → `state.promptWord = await getCurrentPrompt(state.entry.date)`.
- `init()` is already `async`; the save-filename path in `doodleDecorate.js` reads
  `state.promptWord` and is untouched.

### 5. `.github/workflows/generate-message.yml` (extend)

- Add a step after "Generate message" that runs only on the AM slot:
  - `if: steps.slot.outputs.slot == 'am'`
  - `run: node scripts/generate-prompt.mjs`
  - same `GITHUB_TOKEN` env.
- Add `data/prompts.json` to the `git add` list in the commit step.

### 6. `sw.js` (extend)

- Add a `url.pathname.endsWith("/data/prompts.json")` branch using `networkFirst`
  (same as `messages.json`).
- Bump `VERSION` `"v2"` → `"v3"` so the new fetch handler activates.
- `data/prompts.json` does not need to be in `SHELL_ASSETS` (network-first +
  runtime cache mirrors how `messages.json` is handled).

## Data flow

```
AM cron → generate-message.mjs (message) + generate-prompt.mjs (word)
   → GitHub Models (fallback: WORDS list)
   → commits data/messages.json + data/prompts.json
GitHub Pages → index.html → js/main.js
   → getCurrentEntry()  (message)
   → getCurrentPrompt() (doodle word; fallback promptFor() offline)
```

## Error handling

- No token / API error / bad word → deterministic `WORDS` fallback in the script.
- Fetch failure offline → `promptFor(date)` in the client.
- All storage/network access already guarded; degrade gracefully.

## Testing / verification

- Run `node scripts/generate-prompt.mjs` locally with no token → confirms a
  `fallback` entry is written and is a valid `WORDS` word.
- Inspect `data/prompts.json` shape matches the contract.
- Local preview (`python3 -m http.server 8765`): confirm the doodle word in
  `#doodle` mode reflects `data/prompts.json`; simulate fetch failure → confirms
  it falls back to the seeded word.
- Confirm save filename `mindbob_<word>_<date>.png` still uses the new word.

## Open question (resolved default)

`WORDS` reuse in the script: import from `../js/prompts.js` to keep one source of
truth. The script is `.mjs` ESM and `js/prompts.js` is an ES module importing only
`./util.js` (`hashString`) — importing is clean. Default: **import**.

## Out of scope

- Twice-daily prompt generation (kept once/day to preserve AM == PM).
- Folding the prompt into `messages.json`.
- Any change to doodle rendering, palette, or auto-mode layout.

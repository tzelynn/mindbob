# LLM-generated daily doodle prompt — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate the daily doodle prompt word with an LLM via GitHub Actions (mirroring the message pipeline), keeping the existing word-list as the deterministic offline fallback.

**Architecture:** A new `scripts/generate-prompt.mjs` calls GitHub Models once a day (AM cron), validates a single-word result, and writes `data/prompts.json` (same contract style as `messages.json`). The frontend gains an async `getCurrentPrompt(date)` in `js/prompts.js` that fetches that file and falls back to the existing deterministic `promptFor()` offline. The existing workflow and service worker are extended.

**Tech Stack:** Vanilla ES modules, Node 20 (`.mjs`), GitHub Actions, GitHub Models API (`openai/gpt-4o-mini`). No new dependencies.

## Global Constraints

- No framework / no build step / no bundler / no npm deps for the site. Copied verbatim from CLAUDE.md.
- All paths relative (`./data/...`, `./js/...`).
- Cron uses only the built-in `GITHUB_TOKEN` (`models: read` + `contents: write`).
- Deterministic visuals/fallbacks — no `Math.random()`; seed from date.
- Preserve the **AM == PM doodle word** invariant: the prompt word is identical all day.
- `publishAt` is derived from `date` (not wall-clock `now`).
- **Git:** work happens on the existing `qol-opts` feature branch. Each task ends by running its listed verification command and then committing the task's changes (`git add <files> && git commit`). There is no automated test runner — verification commands are the test cycle. Co-author trailer per repo convention.

---

### Task 1: `scripts/generate-prompt.mjs` + seed `data/prompts.json`

**Files:**
- Create: `scripts/generate-prompt.mjs`
- Create: `data/prompts.json` (seed entry)
- Reuse: `js/prompts.js` (imports `WORDS`)

**Interfaces:**
- Consumes: `WORDS` (array of strings) and `promptFor(dateSeed)` from `../js/prompts.js`.
- Produces: `data/prompts.json` with shape
  `{ updated: string, entries: Array<{ id, date, publishAt, word, source }> }`
  where `id === date` (`YYYY-MM-DD`), `publishAt = "${date}T00:00:00.000Z"`,
  `word` is `[a-z]{2,20}`, `source ∈ {"llm","fallback","seed"}`.

- [ ] **Step 1: Write the generator script**

Create `scripts/generate-prompt.mjs`:

```javascript
// Generates ONE daily doodle prompt word and writes it to data/prompts.json.
//
//   node scripts/generate-prompt.mjs
//
// Primary source: GitHub Models (free, uses the Actions GITHUB_TOKEN).
// On any failure (no token, API error, low-quality output) it falls back to the
// curated WORDS list (shared with the frontend) so a fresh word ALWAYS lands.
// Runs once a day (AM cron); the word is identical AM -> PM.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WORDS } from "../js/prompts.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROMPTS_PATH = join(ROOT, "data", "prompts.json");

const API_URL = "https://models.github.ai/inference/chat/completions";
const MODEL = "openai/gpt-4o-mini";
const KEEP = 14;

const SYSTEM_PROMPT =
  "You invent single-word doodle prompts for a calming daily drawing widget. " +
  "Output exactly ONE common, concrete, cheerful noun that's fun and easy to " +
  "sketch in 30 seconds with simple line art — think objects, animals, plants, " +
  "food, weather. Avoid abstract ideas, proper nouns, anything dark, complex " +
  "scenes, or multi-word answers. Surprise me with variety. " +
  "Reply with only the word, lowercase, no punctuation.";

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// publish instant anchored to the date, NOT wall-clock now (mirrors the
// message generator), so the client selection is stable.
function publishAtFor(date) {
  return `${date}T00:00:00.000Z`;
}

function cleanWord(text) {
  if (!text) return "";
  let t = String(text).trim().toLowerCase();
  t = t.replace(/^[^a-z]+|[^a-z]+$/g, ""); // strip surrounding non-letters/quotes
  t = t.split(/\s+/)[0] || ""; // first token only
  return t;
}

function isGoodWord(w, recentWords) {
  if (!w) return false;
  if (!/^[a-z]{2,20}$/.test(w)) return false;
  if (recentWords.includes(w)) return false; // dedupe
  return true;
}

async function fromLLM(recentWords) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("no GITHUB_TOKEN");

  const avoid = recentWords.slice(-10);
  const userContent =
    "Give me today's doodle word." +
    (avoid.length ? " Do not use any of these recent words: " + avoid.join(", ") + "." : "");

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2026-03-10",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.9,
      max_tokens: 12,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    }),
  });

  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return cleanWord(data?.choices?.[0]?.message?.content);
}

// Deterministic fallback: rotate through WORDS by entry count (no Math.random).
function fromBank(recentWords, entryCount) {
  const pool = WORDS.filter((w) => !recentWords.includes(w));
  const choices = pool.length ? pool : WORDS;
  return choices[entryCount % choices.length];
}

async function main() {
  const store = await readJson(PROMPTS_PATH, { updated: "", entries: [] });
  if (!Array.isArray(store.entries)) store.entries = [];
  const recentWords = store.entries.map((e) => e.word);

  let word = "";
  let source = "llm";
  try {
    const candidate = await fromLLM(recentWords);
    if (isGoodWord(candidate, recentWords)) {
      word = candidate;
    } else {
      throw new Error("low-quality output: " + JSON.stringify(candidate));
    }
  } catch (err) {
    console.warn("[prompt] falling back to word list:", err.message);
    word = fromBank(recentWords, store.entries.length);
    source = "fallback";
  }

  const date = todayUTC();
  const entry = { id: date, date, publishAt: publishAtFor(date), word, source };

  store.entries = store.entries.filter((e) => e.id !== entry.id);
  store.entries.push(entry);
  store.entries.sort((a, b) => new Date(a.publishAt) - new Date(b.publishAt));
  store.entries = store.entries.slice(-KEEP);
  store.updated = new Date().toISOString();

  await writeFile(PROMPTS_PATH, JSON.stringify(store, null, 2) + "\n");
  console.log(`[prompt] ${entry.id} (${source}): ${word}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Create the seed data file**

Create `data/prompts.json` (so the site has a word before the first cron run; use today's date `2026-06-27`):

```json
{
  "updated": "2026-06-27T00:00:00.000Z",
  "entries": [
    {
      "id": "2026-06-27",
      "date": "2026-06-27",
      "publishAt": "2026-06-27T00:00:00.000Z",
      "word": "feather",
      "source": "seed"
    }
  ]
}
```

- [ ] **Step 3: Run the generator with no token (exercises the fallback path)**

Run:
```bash
cd "/mnt/c/Users/tze lynn/Documents/Coding/mindbob" && env -u GITHUB_TOKEN node scripts/generate-prompt.mjs
```
Expected: prints `[prompt] falling back to word list: no GITHUB_TOKEN` then
`[prompt] <today> (fallback): <word>`, and exits 0.

- [ ] **Step 4: Assert the written file is valid and matches the contract**

Run:
```bash
cd "/mnt/c/Users/tze lynn/Documents/Coding/mindbob" && node -e '
const fs=require("fs");
const s=JSON.parse(fs.readFileSync("data/prompts.json","utf8"));
const e=s.entries.at(-1);
const ok = e && e.id===e.date && /^[a-z]{2,20}$/.test(e.word)
  && e.publishAt===e.date+"T00:00:00.000Z" && ["llm","fallback","seed"].includes(e.source);
if(!ok){console.error("BAD ENTRY",e);process.exit(1);}
console.log("OK",e);
'
```
Expected: prints `OK { ... }` with a valid lowercase word and exits 0.

- [ ] **Step 5: Re-run to confirm dedupe + same-day replace**

Run the generator twice more without a token and confirm: (a) the same-day `id` is
replaced (not duplicated), (b) `entries.length` stays at 1 for today.
```bash
cd "/mnt/c/Users/tze lynn/Documents/Coding/mindbob" && env -u GITHUB_TOKEN node scripts/generate-prompt.mjs && node -e '
const s=require("./data/prompts.json");
const today=new Date().toISOString().slice(0,10);
const n=s.entries.filter(e=>e.date===today).length;
if(n!==1){console.error("DUP for today:",n);process.exit(1);}
console.log("OK single entry for today");
'
```
Expected: prints `OK single entry for today`.

---

### Task 2: `getCurrentPrompt()` in `js/prompts.js`

**Files:**
- Modify: `js/prompts.js`

**Interfaces:**
- Consumes: existing `WORDS`, `promptFor(dateSeed)`, `hashString` (already imported).
- Produces: `async getCurrentPrompt(date, now = new Date()) => Promise<string>` —
  fetches `./data/prompts.json`, returns the `word` of the entry with the greatest
  `publishAt <= now`; falls back to `promptFor(date)` on any error / no entry.

- [ ] **Step 1: Add the fetch + select + fallback function**

Append to `js/prompts.js` (keep `WORDS` and `promptFor` unchanged):

```javascript
// Select the current entry's word from data/prompts.json (greatest publishAt
// <= now), mirroring messages.js selection. Falls back to the deterministic
// date-seeded promptFor() when the file is missing/empty (offline, pre-cron).
export async function getCurrentPrompt(date, now = new Date()) {
  try {
    const res = await fetch("./data/prompts.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("prompts " + res.status);
    const data = await res.json();
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    if (!entries.length) throw new Error("no entries");
    const sorted = [...entries].sort(
      (a, b) => new Date(a.publishAt) - new Date(b.publishAt)
    );
    const nowMs = now.getTime();
    let chosen = null;
    for (const e of sorted) {
      if (new Date(e.publishAt).getTime() <= nowMs) chosen = e;
    }
    chosen = chosen || sorted[0];
    const word = chosen && typeof chosen.word === "string" ? chosen.word.trim() : "";
    if (!word) throw new Error("empty word");
    return word;
  } catch {
    return promptFor(date);
  }
}
```

- [ ] **Step 2: Verify the module parses and the fallback works under Node**

Run (no network in Node → exercises the catch/fallback branch):
```bash
cd "/mnt/c/Users/tze lynn/Documents/Coding/mindbob" && node -e '
import("./js/prompts.js").then(async (m) => {
  const w = await m.getCurrentPrompt("2026-06-27");
  const seeded = m.promptFor("2026-06-27");
  if (w !== seeded) { console.error("expected fallback to promptFor:", w, seeded); process.exit(1); }
  if (!m.WORDS.includes(w)) { console.error("not a WORDS word:", w); process.exit(1); }
  console.log("OK fallback word:", w);
});
'
```
Expected: prints `OK fallback word: <word>` (Node has no `fetch` target for a
relative path, so it falls back to `promptFor`, which is the correct offline behavior).

---

### Task 3: Wire `getCurrentPrompt` into `js/main.js`

**Files:**
- Modify: `js/main.js:7` (import) and `js/main.js:41` (call site)

**Interfaces:**
- Consumes: `getCurrentPrompt` from `./prompts.js`.
- Produces: `state.promptWord` set to the fetched/fallback word (unchanged downstream contract — `doodleDecorate.js` reads `state.promptWord`).

- [ ] **Step 1: Update the import**

In `js/main.js`, change line 7:
```javascript
import { promptFor } from "./prompts.js";
```
to:
```javascript
import { getCurrentPrompt } from "./prompts.js";
```

- [ ] **Step 2: Update the call site**

In `js/main.js`, change line 41 (inside the already-`async` `init()`):
```javascript
  state.promptWord = promptFor(state.entry.date);
```
to:
```javascript
  state.promptWord = await getCurrentPrompt(state.entry.date);
```

- [ ] **Step 3: Verify no other reference to `promptFor` remains in main.js**

Run:
```bash
cd "/mnt/c/Users/tze lynn/Documents/Coding/mindbob" && grep -n "promptFor\|getCurrentPrompt" js/main.js
```
Expected: shows only the new `getCurrentPrompt` import (line 7) and the new call
(line 41); no remaining bare `promptFor(` call in `main.js`.

- [ ] **Step 4: Visual verification in the browser**

Start the preview and screenshot `#doodle` mode; confirm the prompt word shown
matches the `word` in `data/prompts.json` (currently the seed/last-generated word).
```bash
cd "/mnt/c/Users/tze lynn/Documents/Coding/mindbob" && python3 -m http.server 8765 &
```
Then load `http://localhost:8765/index.html#doodle` with the `chromium` binary
(write the screenshot under `/home/<user>/` per CLAUDE.md) and confirm the doodle
prompt label equals `data/prompts.json`'s current `word`. Stop the server when done.

---

### Task 4: Generate the prompt in the workflow (AM only)

**Files:**
- Modify: `.github/workflows/generate-message.yml`

**Interfaces:**
- Consumes: `steps.slot.outputs.slot` (existing), `secrets.GITHUB_TOKEN`.
- Produces: an updated `data/prompts.json` committed alongside `data/messages.json` on AM runs.

- [ ] **Step 1: Add the prompt-generation step after "Generate message"**

In `.github/workflows/generate-message.yml`, immediately after the "Generate
message" step (before "Rebuild doodle manifest"), insert:

```yaml
      - name: Generate doodle prompt
        if: steps.slot.outputs.slot == 'am'
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: node scripts/generate-prompt.mjs
```

- [ ] **Step 2: Add `data/prompts.json` to the commit**

In the "Commit and push" step, change the `git add` line from:
```yaml
          git add data/messages.json doodles/index.json
```
to:
```yaml
          git add data/messages.json data/prompts.json doodles/index.json
```

- [ ] **Step 3: Lint the YAML**

Run:
```bash
cd "/mnt/c/Users/tze lynn/Documents/Coding/mindbob" && python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/generate-message.yml')); print('YAML OK')"
```
Expected: prints `YAML OK` (no exception). Also visually confirm the new step is
under `jobs.generate.steps` with correct indentation and the `if` guard.

---

### Task 5: Service worker — network-first for `data/prompts.json`

**Files:**
- Modify: `sw.js`

**Interfaces:**
- Consumes: existing `networkFirst(request)` helper.
- Produces: `data/prompts.json` served network-first (fresh online, cached offline); cache version bumped so the handler activates.

- [ ] **Step 1: Bump the cache version**

In `sw.js`, change:
```javascript
const VERSION = "v2";
```
to:
```javascript
const VERSION = "v3";
```

- [ ] **Step 2: Add the prompts.json fetch branch**

In `sw.js`, in the `fetch` listener, directly after the `messages.json`
network-first block, add:

```javascript
  // Doodle prompt: network-first (fresh when online, last word offline).
  if (url.pathname.endsWith("/data/prompts.json")) {
    event.respondWith(networkFirst(request));
    return;
  }
```

- [ ] **Step 3: Verify the service worker still parses**

Run:
```bash
cd "/mnt/c/Users/tze lynn/Documents/Coding/mindbob" && node --check sw.js && echo "sw.js OK"
```
Expected: prints `sw.js OK` (syntax valid). Confirm `VERSION` is `"v3"` and the new
branch sits beside the `messages.json` branch.

---

## Self-Review

**Spec coverage:**
- Generator `scripts/generate-prompt.mjs` (creative system prompt, validation, dedupe, deterministic fallback, date-anchored publishAt) → Task 1. ✓
- `data/prompts.json` contract + seed → Task 1. ✓
- `getCurrentPrompt()` + keep `promptFor`/`WORDS` fallback → Task 2. ✓
- `main.js` one-line wiring → Task 3. ✓
- Workflow AM-only step + commit prompts.json → Task 4. ✓
- Service worker network-first + version bump → Task 5. ✓
- AM==PM invariant (once/day, no slot) → Task 1 contract. ✓
- Constraints (no deps, relative paths, GITHUB_TOKEN-only, no Math.random, derived publishAt) → Global Constraints + Task 1. ✓

**Placeholder scan:** No TBD/TODO; all code shown in full; all commands have expected output. ✓

**Type consistency:** `WORDS` (string[]), `promptFor(dateSeed)`, `getCurrentPrompt(date, now)` used consistently across Tasks 1–3. `data/prompts.json` entry fields (`id/date/publishAt/word/source`) consistent between generator (Task 1) and selector (Task 2). ✓

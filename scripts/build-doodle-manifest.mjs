// Regenerates doodles/index.json from the .svg files in doodles/.
// Run after adding/removing doodles (the cron workflow does this automatically).
//
//   node scripts/build-doodle-manifest.mjs

import { readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "doodles");
const OUT = join(DIR, "index.json");

const files = (await readdir(DIR))
  .filter((f) => f.toLowerCase().endsWith(".svg"))
  .sort();

await writeFile(OUT, JSON.stringify(files, null, 2) + "\n");
console.log(`[doodles] ${files.length} doodles -> doodles/index.json`);

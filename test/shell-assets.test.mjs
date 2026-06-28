import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// Read SHELL_ASSETS from sw.js
function extractShellAssets(swSource) {
  const match = swSource.match(/const SHELL_ASSETS\s*=\s*\[([\s\S]*?)\];/);
  if (!match) throw new Error("Could not find SHELL_ASSETS in sw.js");
  const inner = match[1];
  const assets = [];
  const re = /["'](\.\/[^"']+)["']/g;
  let m;
  while ((m = re.exec(inner)) !== null) {
    assets.push(m[1]);
  }
  return assets;
}

// Extract all relative .js module specifiers from a JS source file
function extractImportedModules(source) {
  const re = /(?:from|import)\s*\(?\s*["'](\.\/[^"']+\.js)["']/g;
  const found = [];
  let m;
  while ((m = re.exec(source)) !== null) {
    found.push(m[1]);
  }
  return found;
}

test("SHELL_ASSETS covers the full import graph of js/ modules", () => {
  const swSource = readFileSync(join(root, "sw.js"), "utf8");
  const shellAssets = extractShellAssets(swSource);

  // Collect all relative module specifiers imported across js/*.js files
  const jsFiles = readdirSync(join(root, "js")).filter((f) => f.endsWith(".js"));
  const importedSpecifiers = new Set();

  for (const file of jsFiles) {
    const source = readFileSync(join(root, "js", file), "utf8");
    for (const spec of extractImportedModules(source)) {
      // Specifiers are relative to js/ dir: ./foo.js -> ./js/foo.js
      const resolved = "./js/" + spec.replace(/^\.\//, "");
      importedSpecifiers.add(resolved);
    }
  }

  // Also assert the entry module itself is present
  importedSpecifiers.add("./js/main.js");

  const missing = [...importedSpecifiers].filter((m) => !shellAssets.includes(m));
  assert.deepEqual(
    missing,
    [],
    `SHELL_ASSETS is missing these modules (offline load will break): ${missing.join(", ")}`
  );
});

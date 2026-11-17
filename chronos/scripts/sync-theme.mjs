#!/usr/bin/env node
// Copies the Olympus theme (chronos/theme/olympus.json, built by chronos/theme/build.py)
// into the web client as its built-in theme. Run after rebuilding the theme:
//   node chronos/scripts/sync-theme.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = join(root, "chronos/theme/olympus.json");
const target = join(root, "apps/web/src/chronos/olympus.theme.json");

const theme = JSON.parse(readFileSync(source, "utf8"));
for (const field of ["name", "appearance", "colors"]) {
  if (!theme[field]) throw new Error(`olympus.json has no ${field}`);
}
if (!theme.variants?.dark) throw new Error("olympus.json has no night (variants.dark) palette");
delete theme.id;
writeFileSync(target, `${JSON.stringify(theme)}\n`);
console.log(`olympus theme -> ${target} (${theme.css?.length ?? 0} chars of CSS)`);

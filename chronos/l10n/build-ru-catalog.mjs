#!/usr/bin/env node
// Builds apps/web/src/chronos/i18n/ru.catalog.json: Chronos' Russian catalog for interface
// strings that upstream has not wrapped in gt-react's <T>/gt() yet. Sources, lowest priority first:
//   chronos/legacy-package/client/l10n/ru.json, ru-final.json (all tiers),
//   runtime*.json (strings checked in the live app), chronos/l10n/ru.overrides.json (ours).
// Minified bundle templates like "Delete (${a})" become anchored patterns.
// Usage: node chronos/l10n/build-ru-catalog.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const legacy = join(repo, "chronos", "legacy-package", "client", "l10n");
const out = join(repo, "apps", "web", "src", "chronos", "i18n", "ru.catalog.json");
const read = (path) => JSON.parse(readFileSync(path, "utf8"));

const exact = new Map();
const patterns = new Map();
const put = (en, ru) => {
  if (typeof en !== "string" || typeof ru !== "string") return;
  const key = en.trim();
  const value = ru.trim();
  if (key.length < 2 || key === value || !/[A-Za-z]/.test(key)) return;
  if (key.includes("${")) {
    const pattern = templateToPattern(key, value);
    if (pattern) patterns.set(pattern[0], pattern[1]);
    return;
  }
  exact.set(key, value);
};

/** "Delete (${a}) of ${b}" -> ["^Delete \\((.+?)\\) of (.+?)$", "... $1 ... $2"]. */
function templateToPattern(en, ru) {
  const names = [];
  const source = en
    .split(/(\$\{[^}]*\})/)
    .map((part) => {
      if (/^\$\{[^}]*\}$/.test(part)) {
        names.push(part);
        return "(.+?)";
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  // Without a literal anchor a template matches almost anything; leave those alone.
  if (en.replace(/\$\{[^}]*\}/g, "").replace(/[^A-Za-z]/g, "").length < 3) return null;
  let replacement = ru;
  const unique = [...new Set(names)];
  if (unique.length !== names.length) return null;
  for (const [index, name] of unique.entries()) {
    if (!replacement.includes(name)) return null;
    replacement = replacement.split(name).join(`$${index + 1}`);
  }
  if (replacement.includes("${")) return null;
  return [`^${source}$`, replacement];
}

const ruJson = read(join(legacy, "ru.json"));
for (const [en, ru] of Object.entries(ruJson)) put(en, ru);
const final = read(join(legacy, "ru-final.json"));
for (const tier of ["broad", "strict", "label", "presentational"]) {
  for (const [en, ru] of Object.entries(final[tier] ?? {})) put(en, ru);
}
for (const file of [
  "runtime.ru.json",
  "runtime-final.json",
  "runtime-extra-translation.json",
  "runtime-extra-lead.json",
]) {
  const dict = read(join(legacy, file));
  for (const [en, ru] of Object.entries(dict.exact ?? {})) put(en, ru);
  for (const [source, replacement] of dict.patterns ?? []) patterns.set(source, replacement);
}
const overrides = read(join(here, "ru.overrides.json"));
for (const [en, ru] of Object.entries(overrides.exact ?? {})) put(en, ru);
for (const [source, replacement] of overrides.patterns ?? []) patterns.set(source, replacement);
for (const en of overrides.drop ?? []) exact.delete(en);

const sorted = [...exact.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
const lines = sorted.map(([en, ru]) => `    ${JSON.stringify(en)}: ${JSON.stringify(ru)}`);
const patternLines = [...patterns.entries()].map((entry) => `    ${JSON.stringify(entry)}`);
writeFileSync(
  out,
  `{\n  "exact": {\n${lines.join(",\n")}\n  },\n  "patterns": [\n${patternLines.join(",\n")}\n  ]\n}\n`,
);
console.log(`ru.catalog.json: ${sorted.length} strings, ${patterns.size} patterns`);

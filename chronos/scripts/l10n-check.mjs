#!/usr/bin/env node
// Russian interface check: coverage and broken placeholders.
//   1. Upstream gt-react catalogs (apps/web/src/i18n/translations): ru keys vs en, {var} names.
//   2. Chronos catalog (apps/web/src/chronos/i18n/ru.catalog.json): placeholders, patterns.
//   3. Coverage: interface literals found in apps/web/src (JSX text, text props, label/title/...
//      fields) that the Chronos catalog or gt translates.
// Usage: node chronos/scripts/l10n-check.mjs [--missing [file]] [--min <percent>]
// Exits 1 on broken placeholders or coverage below --min.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const web = join(repo, "apps", "web");
const args = process.argv.slice(2);
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const problems = [];

// --- placeholders -------------------------------------------------------------------------
const PLACEHOLDER = /\$\{[^}]*\}|\{\{\s*[\w.]+\s*\}\}|\{[\w.]+\}|%\d*\$?[sdif]|<\/?\d+>/g;
const placeholders = (text) => (text.match(PLACEHOLDER) ?? []).map((p) => p.replace(/\s+/g, "")).sort();
const sameList = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

// --- 1. upstream gt catalogs --------------------------------------------------------------
const gtDir = join(web, "src", "i18n", "translations");
const gtEn = read(join(gtDir, "en.json"));
const gtRu = read(join(gtDir, "ru.json"));
const gtText = (value) => (typeof value === "string" ? value : JSON.stringify(value));
const gtVars = (value) => [...new Set(gtText(value).match(/\{\s*[\w]+/g) ?? [])].map((v) => v.replace(/[{\s]/g, "")).sort();
let gtTranslated = 0;
for (const [hash, source] of Object.entries(gtEn)) {
  if (!(hash in gtRu)) continue;
  gtTranslated += 1;
  if (!sameList(gtVars(source), gtVars(gtRu[hash]))) {
    problems.push(`gt ru.json ${hash}: placeholders ${gtVars(source)} vs ${gtVars(gtRu[hash])}`);
  }
}
const gtTotal = Object.keys(gtEn).length;

// --- 2. Chronos catalog -------------------------------------------------------------------
const catalog = read(join(web, "src", "chronos", "i18n", "ru.catalog.json"));
const exact = new Map(Object.entries(catalog.exact));
for (const [en, ru] of exact) {
  if (!sameList(placeholders(en), placeholders(ru))) {
    problems.push(`catalog ${JSON.stringify(en)}: placeholders [${placeholders(en)}] vs [${placeholders(ru)}]`);
  }
}
const patterns = [];
for (const [source, replacement] of catalog.patterns) {
  let pattern;
  try {
    pattern = new RegExp(source);
  } catch (error) {
    problems.push(`pattern ${source}: ${error.message}`);
    continue;
  }
  const groups = new RegExp(`${source}|`).exec("").length - 1;
  for (const [, index] of replacement.matchAll(/\$(\d)/g)) {
    if (Number(index) < 1 || Number(index) > groups) {
      problems.push(`pattern ${source}: replacement uses $${index}, has ${groups} groups`);
    }
  }
  if (!sameList(placeholders(source.replace(/\\(.)/g, "$1")), placeholders(replacement))) {
    problems.push(`pattern ${source}: placeholders differ from ${JSON.stringify(replacement)}`);
  }
  patterns.push(pattern);
}

// --- 3. coverage of interface literals ----------------------------------------------------
function* sourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "chronos" || entry.name === "i18n" || entry.name === "node_modules") continue;
      yield* sourceFiles(path);
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|browser\.test|spec)\.tsx?$|\.d\.ts$/.test(entry.name)) {
      yield path;
    }
  }
}

const TEXT_PROP = /\b(?:title|placeholder|aria-label|alt|label|description|tooltip|emptyText|confirmLabel|cancelLabel)="([^"{}]{2,})"/g;
const TEXT_FIELD = /\b(?:label|title|description|placeholder|message|tooltip|confirmLabel|cancelLabel|detail|emptyText|heading)\s*:\s*"((?:[^"\\\n]|\\.){2,})"/g;
const JSX_STRING = /\{\s*"((?:[^"\\\n]|\\.){2,})"\s*\}/g;
const JSX_TEXT = />([^<>{}`]+)</g;
// Type annotations, keys, class lists and URLs that the regexes above also pick up.
const NOT_TEXT =
  /^[,.]\s*\w+\??:|^\w+(?:[:-]\w+)*:[\w-]+(?::[\w-]+)*$|^new \w+$|\b(?:Readonly\w*|ReadonlySet|ReadonlyMap|RefObject|Pick)\b|^, \w+:|\[[^\]]*_[^\]]*\]|^https?:\/\/|^\d+ [?:]|\?\.\w|^\+ \w+ \+$|^"[^"]*", icon:$/;
const looksLikeText = (text) =>
  /[A-Za-z]{2}/.test(text) &&
  !NOT_TEXT.test(text) &&
  !/[=;|&\\]|=>|\(\)|^[\w.-]+$|^[a-z][\w-]*(\s+[a-z][\w-]*:?[\w/[\]-]*)+$/.test(text) &&
  !/^(?:[a-z0-9-]+:)?[a-z0-9[\]/.%-]+(?:\s+[a-z0-9[\]/.%:-]+)*$/.test(text);

const found = new Map();
for (const file of sourceFiles(join(web, "src"))) {
  const code = readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const add = (raw) => {
    const text = raw.replace(/\\"/g, '"').replace(/\s+/g, " ").trim();
    if (text.length < 2 || !looksLikeText(text)) return;
    if (!found.has(text)) found.set(text, relative(repo, file).replaceAll("\\", "/"));
  };
  for (const regex of [TEXT_PROP, TEXT_FIELD, JSX_STRING]) {
    for (const match of code.matchAll(regex)) add(match[1]);
  }
  if (file.endsWith(".tsx")) {
    for (const match of code.matchAll(JSX_TEXT)) {
      const text = match[1];
      // JSX text sits on its own lines or between tags, never next to code punctuation.
      if (/[()[\];]|\b(?:const|return|import|export|function|type|interface)\b/.test(text)) continue;
      add(text);
    }
  }
}

const gtSources = new Set(Object.values(gtEn).map(gtText));
// Names and samples chronos/l10n/ru.overrides.json keeps in English on purpose.
const keep = new Set(read(join(repo, "chronos", "l10n", "ru.overrides.json")).keep ?? []);
const translated = (text) => {
  if (exact.has(text) || gtSources.has(text) || keep.has(text)) return true;
  // A brand-only string ("T3 Code") needs no translation.
  if (/^(?:T3 Code|Chronos|T3 Connect|GitHub|Git|Codex|Claude|OpenCode|MCP|SSH|WSL|URL|API)$/.test(text)) return true;
  return patterns.some((pattern) => pattern.test(text));
};
const missing = [];
let covered = 0;
for (const [text, file] of found) {
  if (translated(text)) covered += 1;
  else missing.push(`${file}\t${text}`);
}
const percent = (part, total) => (total === 0 ? 100 : (100 * part) / total);
const coverage = percent(covered, found.size);

console.log(`gt-react ru.json:      ${gtTranslated}/${gtTotal} keys (${percent(gtTranslated, gtTotal).toFixed(1)}%)`);
console.log(`Chronos catalog:       ${exact.size} strings, ${patterns.length} patterns`);
console.log(`Interface literals:    ${covered}/${found.size} translated (${coverage.toFixed(1)}%)`);
console.log(`Broken placeholders:   ${problems.length}`);
for (const problem of problems.slice(0, 40)) console.log(`  - ${problem}`);
if (problems.length > 40) console.log(`  ... ${problems.length - 40} more`);

const missingIndex = args.indexOf("--missing");
if (missingIndex !== -1) {
  const target = args[missingIndex + 1] && !args[missingIndex + 1].startsWith("--")
    ? args[missingIndex + 1]
    : join(repo, "chronos", ".work", "l10n-missing.tsv");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${missing.sort().join("\n")}\n`);
  console.log(`Missing strings:       ${target}`);
}
const minIndex = args.indexOf("--min");
const min = minIndex === -1 ? 0 : Number(args[minIndex + 1]);
if (problems.length > 0 || coverage < min) process.exit(1);

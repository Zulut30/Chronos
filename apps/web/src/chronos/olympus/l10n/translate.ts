// @effect-diagnostics nodeBuiltinImport:off -- Build-time translator used by the Vite plugin and parity scripts in Node.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const tableNames = ["presentational", "label", "strict", "broad"] as const;
type Table = (typeof tableNames)[number];
export type Counts = Record<Table, Record<string, number>>;
type Tables = Record<Table, Record<string, string>>;

// UTF-16 positions in the input to one pass. The keyed pass precedes the broad pass.
export type Edit = { start: number; end: number; length: number };

const presentational = new Set([
  "children", "placeholder", '"aria-label"', "ariaLabel", "tooltip", "description", "heading",
  "subtitle", "hint", "actionLabel", "confirmLabel", "cancelLabel", "buttonLabel", "helperText",
  "emptyText", "emptyMessage", "caption", "alt",
]);
const keys = [...presentational, "label", "title", "text", "message", "detail", "summary"].join("|");
// patch-combined.py permits unescaped backticks as delimiters and a single level of interpolation.
const body = /(?:[^\x60$\\]|\$(?!\{)|\$\{[^\x60{}]*\})*/.source;
const keyed = new RegExp("(?<![\\p{L}\\p{N}_$.])" + "(" + keys + "):`(" + body + ")`", "gu");
const literal = new RegExp("`(" + body + ")`", "gu");
// Python str.strip also treats U+001C..001F as whitespace and leaves the BOM alone.
const leading = /^[\p{White_Space}\x1c-\x1f]+/u;
const trailing = /[\p{White_Space}\x1c-\x1f]+$/u;
// GT's generated JSON modules export messages under their 16-hex-digit translation IDs.
const catalogExports = /\bas ["']?[\da-f]{16}["']?\s*,\s*[\w$]+ as ["']?[\da-f]{16}["']?\s*[,}]/u;
const terminalRpc = /\bterminalOpen\s*:\s*["'`]terminal\.open["'`]/u;
const configRpc = /\bserverGetConfig\s*:\s*["'`]server\.getConfig["'`]/u;

export function newCounts(): Counts {
  return {
    presentational: Object.create(null), label: Object.create(null),
    strict: Object.create(null), broad: Object.create(null),
  };
}

export const tableFiles = [
  "ru-final.json", "blocked-server.json", "unsafe.json", "unsafe-presentational.en.json",
];

export function loadTables(directory: string): Tables {
  const read = (name: string) => JSON.parse(readFileSync(join(directory, name), "utf8"));
  const tables: Tables = read("ru-final.json");
  // The allowlists in ru-final already incorporate these exclusions. Preserve them if edited.
  // Olympus permits server labels in display props, and compared values only in presentation props.
  for (const key of read("blocked-server.json") as string[]) {
    delete tables.strict[key];
    delete tables.broad[key];
  }
  for (const name of ["unsafe.json", "unsafe-presentational.en.json"]) {
    for (const key of read(name) as string[]) {
      delete tables.label[key];
      delete tables.strict[key];
      delete tables.broad[key];
    }
  }
  return tables;
}

export function translateChunk(code: string, tables: Tables, counts: Counts) {
  const passes: [Edit[], Edit[]] = [[], []];
  // Identify the shared RPC/schema chunk and GT catalog objects from their contents.
  // The original patch excluded one hashed utils filename and the nine hashed locale filenames.
  if (!code.includes("jsx") || (terminalRpc.test(code) && configRpc.test(code)) || catalogExports.test(code)) {
    return { code, keyedCode: code, passes };
  }

  function replace(text: string, table: Table, start: number, edits: Edit[]) {
    const dict = tables[table];
    if (!Object.hasOwn(dict, text) || !dict[text]) return text;
    const prefix = text.match(leading)?.[0] ?? "";
    const suffix = text.match(trailing)?.[0] ?? "";
    const middle = dict[text].replace(leading, "").replace(trailing, "");
    const result = prefix + middle + suffix;
    if (result !== text) {
      counts[table][text] = (counts[table][text] ?? 0) + 1;
      edits.push({ start: start + prefix.length, end: start + text.length - suffix.length, length: middle.length });
    }
    return result;
  }

  const first = code.replace(keyed, (match: string, key: string, en: string, offset: number) => {
    const table = presentational.has(key) ? "presentational" : key === "label" ? "label" : "strict";
    const value = replace(en, table, offset + key.length + 2, passes[0]);
    return value === en ? match : key + ":`" + value + "`";
  });
  const second = first.replace(literal, (match: string, en: string, offset: number) => {
    const value = replace(en, "broad", offset + 1, passes[1]);
    return value === en ? match : "`" + value + "`";
  });
  return { code: second, keyedCode: first, passes };
}

export function checkCoverage(
  actual: Counts, expected: Counts, strict: boolean, warn: (message: string) => void,
) {
  const missing: string[] = [];
  const totals = tableNames.map((table) => {
    for (const [text, required] of Object.entries(expected[table])) {
      const count = actual[table][text] ?? 0;
      if (count < required) missing.push(table + " " + count + "/" + required + " " + JSON.stringify(text));
    }
    const total = Object.values(actual[table]).reduce((a, b) => a + b, 0);
    return table + "=" + total;
  });
  if (missing.length) {
    const message = "[olympus-l10n] " + totals.join(", ") + "\nBelow 4774 coverage:\n" + missing.join("\n");
    if (strict) throw new Error(message);
    warn(message);
  }
  return totals.join(", ");
}

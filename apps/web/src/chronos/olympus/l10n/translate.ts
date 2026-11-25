// @effect-diagnostics nodeBuiltinImport:off -- Shared by the build plugin and offline parity verifier.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { visitStrings, type Parse, type Site } from "./contexts.ts";

export const tableNames = ["presentational", "label", "strict", "broad"] as const;
export type Table = (typeof tableNames)[number];
export type Counts = Record<Table, Record<string, number>>;
export type Edit = { start: number; end: number; length: number; text: string };
type Tables = Record<Table, Record<string, string>>;
const presentational = new Set(["children", "placeholder", "aria-label", "ariaLabel", "tooltip",
  "description", "heading", "subtitle", "hint", "actionLabel", "confirmLabel", "cancelLabel",
  "buttonLabel", "helperText", "emptyText", "emptyMessage", "caption", "alt"]);
const strict = new Set(["title", "text", "message", "detail", "summary"]);
const leading = /^[\p{White_Space}\x1c-\x1f]+/u;
const trailing = /[\p{White_Space}\x1c-\x1f]+$/u;
const slot = /\$\{([^`{}]*)\}/gu;

export function newCounts(): Counts {
  return { presentational: Object.create(null), label: Object.create(null),
    strict: Object.create(null), broad: Object.create(null) };
}

export const tableFiles = ["ru-final.json", "blocked-server.json", "unsafe.json", "unsafe-presentational.en.json"];
export const contextFile = "occurrence-contexts.json";
// Each rule holds a dictionary key (null = preserved in LIVE) and indexed ESTree context features.
export type Rule = [string | true | null, ...[number, string][]];
export type Rules = Record<Table, Record<string, Rule[]>>;
type Recipe = { key: string; output: string[]; order: number[]; same: [number, number][] };
type Group = { key: string; recipes: Recipe[] };
type Dictionary = { index: Record<Table, Map<string, Group>>; rules: Rules; outputs: Set<string>; catalogSources?: ReadonlySet<string> };

function parts(key: string) { return key.split(/\$\{[^`{}]*\}/u); }
export function templateShape(key: string) { return JSON.stringify(parts(key)); }

export function readDictionaries(directory: string): Tables {
  const read = (file: string) => JSON.parse(readFileSync(join(directory, file), "utf8"));
  const tables: Tables = read("ru-final.json");
  for (const [file, excluded] of [
    ["blocked-server.json", ["strict", "broad"]],
    ["unsafe.json", ["label", "strict", "broad"]],
    ["unsafe-presentational.en.json", ["label", "strict", "broad"]],
  ] as const) {
    const blocked = new Set((read(file) as string[]).map(templateShape));
    for (const table of excluded) {
      for (const key of Object.keys(tables[table])) if (blocked.has(templateShape(key))) delete tables[table][key];
    }
  }
  return tables;
}

export function loadTables(directory: string, rules?: Rules): Dictionary {
  const tables = readDictionaries(directory), outputs = new Set<string>();
  const index = { presentational: new Map(), label: new Map(), strict: new Map(), broad: new Map() } as Dictionary["index"];
  for (const table of tableNames) {
    for (const [key, value] of Object.entries(tables[table])) {
      const id = templateShape(key), group: Group = index[table].get(id) ?? { key, recipes: [] };
      const slots = Array.from(key.matchAll(slot), (m) => m[1]!);
      const translatedSlots = Array.from(value.matchAll(slot), (m) => m[1]!);
      if (slots.toSorted().join("\0") !== translatedSlots.toSorted().join("\0")) {
        throw new Error("Translation changes the set or multiplicity of placeholders in " + key);
      }
      const order = translatedSlots.map((expr) => slots.indexOf(expr));
      const same: [number, number][] = [];
      slots.forEach((expr, i) => { if (slots.indexOf(expr) !== i) same.push([slots.indexOf(expr), i]); });
      const fitted = (key.match(leading)?.[0] ?? "") + value.replace(leading, "").replace(trailing, "") + (key.match(trailing)?.[0] ?? "");
      outputs.add(templateShape(fitted));
      group.recipes.push({ key, output: parts(fitted), order, same });
      index[table].set(id, group);
    }
  }
  return { index, outputs, rules: rules ?? JSON.parse(readFileSync(join(directory, contextFile), "utf8")) };
}

export function candidate(site: Site, dict: Dictionary) {
  const id = JSON.stringify(site.parts);
  const prop = site.property;
  const table: Table = presentational.has(prop) ? "presentational" : prop === "label" ? "label" : strict.has(prop) ? "strict" : "broad";
  const keyed = dict.index[table].get(id);
  if (keyed) return { table, group: keyed };
  const broad = dict.index.broad.get(id);
  if (broad) return { table: "broad" as const, group: broad };
  return undefined;
}

function render(recipe: Recipe, site: Site): string | undefined {
  if (recipe.same.some(([a, b]) => site.slots[a] !== site.slots[b])) return undefined;
  if (site.quote !== "`") {
    const escaped = JSON.stringify(recipe.output[0]).slice(1, -1);
    return site.quote === "'" ? escaped.replaceAll("\\\"", "\"").replaceAll("'", "\\'") : escaped;
  }
  const escaped = recipe.output.map((part) => part.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${"));
  return escaped.map((part, i) => i === 0 ? part : "${" + site.slots[recipe.order[i - 1]!] + "}" + part).join("");
}

export type Finding = { file: string; offset: number; table: Table; key: string; context: string; reason: string };

export function inspectChunk(code: string, file: string, dict: Dictionary, parse: Parse) {
  const edits: (Edit & { table: Table; key: string })[] = [], unresolved: Finding[] = [];
  visitStrings(code, parse, (site) => {
    if (site.catalogArgument && !site.slots.length && dict.catalogSources?.has(site.parts[0]!)) return;
    const hit = candidate(site, dict);
    if (!hit) return dict.outputs.has(JSON.stringify(site.parts));
    const { group, table } = hit;
    const scope = dict.rules[table];
    const rules = Object.hasOwn(scope, group.key) ? scope[group.key] : undefined;
    let recipes = group.recipes;
    if (rules) {
      const context = site.context(rules.some(([, ...when]) => when.some(([i]) => i >= 6)));
      const matching = rules.filter(([, ...when]) => when.every(([index, value]) => context[index] === value));
      if (matching.length && matching.every(([key]) => key === null)) return;
      const allowed = new Set(matching.map(([key]) => key === true ? group.key : key));
      recipes = allowed.has(null) ? [] : recipes.filter((r) => allowed.has(r.key));
    } else if (table === "broad") recipes = [];
    const results = new Map(recipes.map((r) => [render(r, site), r.key]));
    const text = results.size === 1 ? results.keys().next().value : undefined;
    if (text === undefined) {
      unresolved.push({ file, offset: site.start, table, key: group.key, reason: "unrecognized or ambiguous usage",
        context: code.slice(Math.max(0, site.start - 70), Math.min(code.length, site.end + 70)) });
    } else {
      const start = site.start + 1, end = site.end - 1;
      if (text !== code.slice(start, end)) {
        const key = results.get(text)!;
        const source = code.slice(start, end);
        const prefix = text.match(leading)?.[0] ?? "", suffix = text.match(trailing)?.[0] ?? "";
        const lead = source.startsWith(prefix) ? prefix.length : 0, tail = source.endsWith(suffix) ? suffix.length : 0;
        edits.push({ start: start + lead, end: end - tail, length: text.length - lead - tail,
          text: text.slice(lead, text.length - tail), table, key });
      }
    }
    // The slot source is opaque in both the English and the already translated literal.
    return text !== undefined;
  });
  return { edits, unresolved };
}

export function translateChunk(code: string, file: string, tables: Dictionary, counts: Counts, parse: Parse) {
  const { edits, unresolved } = inspectChunk(code, file, tables, parse);
  const parts: string[] = [];
  let previous = 0;
  for (const edit of edits) {
    if (edit.start < previous) throw new Error("Overlapping Olympus translation in " + file);
    parts.push(code.slice(previous, edit.start), edit.text);
    previous = edit.end;
    counts[edit.table][edit.key] = (counts[edit.table][edit.key] ?? 0) + 1;
  }
  return { code: edits.length ? parts.join("") + code.slice(previous) : code, edits, unresolved };
}

export function remaining(code: string, file: string, tables: Dictionary, parse: Parse) {
  const { edits, unresolved } = inspectChunk(code, file, tables, parse);
  for (const { start, end, table, key } of edits) {
    unresolved.push({ file, offset: start, table, key, reason: "English after translation",
      context: code.slice(Math.max(0, start - 70), end + 70) });
  }
  return unresolved;
}

export function checkCoverage(findings: Finding[], strictMode: boolean, warn: (message: string) => void) {
  if (!findings.length) return;
  const message = "[olympus-l10n] Remaining English occurrences: " + findings.length + "\n" +
    findings.map((f) => f.file + "@" + f.offset + " " + f.table + " " + JSON.stringify(f.key) +
      " (" + f.reason + ") " + JSON.stringify(f.context)).join("\n");
  if (strictMode) throw new Error(message);
  warn(message);
}

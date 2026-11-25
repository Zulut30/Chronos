// @effect-diagnostics nodeBuiltinImport:off -- Vite reads the catalogs before JSON is bundled.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite-plus";

type Catalog = Record<string, unknown>;
type Pairs = Record<string, string>;

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8"));
}

type Pattern = [string, string];
type Overrides = {
  patterns?: Pattern[];
  settings?: Record<string, [string, string]>;
  fallback?: readonly string[];
};

// Only literal, anchored frames with unconstrained text or an explicitly numeric GT slot.
// Match the entire frame including separators. Never run a regex on an interpolated value.
function patternTemplates(patterns: Pattern[]) {
  const frames = new Map<string, { numeric: boolean[]; target: string }>();
  for (const [regex, target] of patterns) {
    if (!regex.startsWith("^") || !regex.endsWith("$") || !/[А-Яа-яЁё]/u.test(target)) continue;
    const numeric: boolean[] = [];
    const frame = regex.slice(1, -1).replace(/\(\.\+\)|\(\\d\+\)/gu, (group) => {
      numeric.push(group !== "(.+)");
      return "\0";
    });
    if (!numeric.length || /[\\()[\]{}|*+?.^$]/u.test(frame) || frames.has(frame)) continue;
    const refs = [...target.matchAll(/\$(\d+)/gu)].map((match) => Number(match[1]));
    if (refs.length !== numeric.length || !numeric.every((_, i) => refs.includes(i + 1))) continue;
    frames.set(frame, { numeric, target });
  }
  return frames;
}

// Translate whole messages only. GT assigns IDs before translation and resolves ICU variables
// at render time. Preserve every variable and rich-text node supplied by the English message.
export function applyOlympusCatalog(en: Catalog, ru: Catalog, pairs: Pairs, options: Overrides = {}) {
  const slot = /\$\{([^{}`]+)\}/gu;
  const normalized = new Map<string, string | null>();
  for (const [source, target] of Object.entries(pairs)) {
    const slots = [...source.matchAll(slot)].map((m) => m[1]!);
    if (!slots.length || new Set(slots).size !== slots.length) continue;
    const key = source.replace(slot, "\0");
    const recipe = target.replace(slot, (_, name: string) => "\0" + slots.indexOf(name) + "\0");
    if (recipe.includes("\0-1\0")) continue;
    const indexes = [...recipe.matchAll(/\0(\d+)\0/gu)].map((m) => Number(m[1]));
    if (indexes.length !== slots.length || new Set(indexes).size !== slots.length) continue;
    normalized.set(key, !normalized.has(key) || normalized.get(key) === recipe ? recipe : null);
  }
  const patterns = patternTemplates(options.patterns ?? []);
  function translate(source: string, variables: string[]): string | undefined {
    if (Object.hasOwn(pairs, source)) return pairs[source];
    const key = source.replace(/\{([\w]+)\}/gu, (value) => {
      variables.push(value);
      return "\0";
    });
    if (/[{}]/u.test(key) || !variables.length) return;
    const frame = patterns.get(key);
    if (!normalized.has(key) && frame && frame.numeric.every((numeric, i) =>
      !numeric || /^\{(?:count|days|hours|minutes|seconds|number|index|total)\}$/iu.test(variables[i]!))) {
      return frame.target.replace(/\$(\d+)/gu, (_, i: string) => variables[Number(i) - 1]!);
    }
    return normalized.get(key)?.replace(/\0(\d+)\0/gu, (_, index: string) => variables[Number(index)]!);
  }
  let changed = 0;
  for (const [id, source] of Object.entries(en)) {
    if (!Object.hasOwn(ru, id)) continue;
    let target: unknown;
    if (typeof source === "string") {
      if (options.fallback?.includes(source)) continue;
      const setting = options.settings?.[id];
      target = setting?.[0] === source ? setting[1] : translate(source, []);
    } else if (Array.isArray(source)) {
      // The nodes themselves stay intact, including nested markup and variable indexes.
      const nativeParts = ru[id];
      if (!Array.isArray(nativeParts)) continue;
      const nodes: unknown[] = [];
      const message = source.map((part) => {
        if (typeof part === "string") return part;
        const localized = nativeParts.find((n) => n && typeof n === "object" && n.i === part?.i);
        nodes.push(localized ?? part);
        return "{olyNode" + (nodes.length - 1) + "}";
      }).join("");
      if (nodes.length) {
        const text = translate(message, []);
        if (text) target = text.split(/(\{olyNode\d+\})/u).filter(Boolean).map((part) => {
          const match = /^\{olyNode(\d+)\}$/u.exec(part);
          return match ? nodes[Number(match[1])] : part;
        });
      }
    }
    if (target !== undefined && JSON.stringify(target) !== JSON.stringify(ru[id])) {
      ru[id] = target;
      changed++;
    }
  }
  return changed;
}

// A known plan has its own full status in DICT.exact. ICU select keys cannot contain spaces.
// Unknown server values always use the original {method} without modification.
function authenticatedStatus(exact: Pairs, patterns: Pattern[]) {
  const prefix = "Authenticated · ";
  const fallback = patterns.find(([regex]) => regex === "^Authenticated · (.+)$")?.[1];
  if (!fallback) return;
  const variants: string[] = [];
  for (const [source, target] of Object.entries(exact)) {
    if (!source.startsWith(prefix)) continue;
    const plan = source.slice(prefix.length);
    if (/^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/u.test(plan) && plan !== "other" && !/[{}']/u.test(target)) {
      variants.push(plan.replaceAll(" ", "_") + " {" + target + "}");
    }
  }
  return "{olympusPlan, select, " + variants.join(" ") + " other {" + fallback.replace("$1", "{method}") + "}}";
}

export function olympusCatalog(): Plugin {
  let root: string;
  return {
    name: "chronos:olympus-gt-catalog",
    enforce: "pre",
    configResolved(config) { root = config.root; },
    load(id) {
      const file = resolve(root, "src/i18n/translations/ru.json");
      if (id.replaceAll("\\", "/") !== file.replaceAll("\\", "/")) return;
      const enPath = resolve(root, "src/i18n/translations/en.json");
      const dictPath = resolve(root, "../../chronos/l10n/ru-final.json");
      const additionsPath = resolve(root, "../../chronos/l10n/gt-additions.json");
      const fixesPath = resolve(root, "src/chronos/olympus/features/87-ru-fixes.js");
      const runtimePath = resolve(root, "src/chronos/olympus/l10n/runtime-translator.js");
      for (const path of [file, enPath, dictPath, additionsPath, runtimePath, fixesPath]) this.addWatchFile(path);
      const runtime = /^const DICT=(\{.*\});const D=/mu.exec(readFileSync(runtimePath, "utf8"))?.[1];
      if (!runtime) throw new Error("Missing Olympus runtime dictionary");
      const { exact, patterns } = JSON.parse(runtime) as { exact: Pairs; patterns: Pattern[] };
      const fixes = /const WORDS=\{([^}]+)\};/u.exec(readFileSync(fixesPath, "utf8"))?.[1];
      if (!fixes || !/^(?:\w+:'[^']+',)*\w+:'[^']+'$/u.test(fixes)) throw new Error("Unknown Olympus WORDS format");
      const words: Pairs = Object.fromEntries([...fixes.matchAll(/(\w+):'([^']+)'/gu)].map((m) => [m[1]!, m[2]!]));
      const tables = readJson<Record<"presentational" | "strict" | "label" | "broad", Pairs>>(dictPath);
      const additions = readJson<{ messages: Pairs; threadDetails: Pairs; settings4774: NonNullable<Overrides["settings"]>; issueStates: NonNullable<Overrides["settings"]>; runtimeLabels: string[]; nativeFallback: string[] }>(additionsPath);
      const pairs = {
        ...additions.messages, ...words, ...exact, ...tables.broad, ...tables.strict, ...tables.label, ...tables.presentational,
        // 24-thread-details used to replace these labels after the static translator ran.
        ...additions.threadDetails,
      };
      // Native composer override N03 supersedes the earlier static translation.
      const placeholder = "Ask anything. @ files, $ skills, / commands";
      pairs[placeholder] = exact[placeholder]!;
      // The visible labels in these slots were translated by the DOM pass in 4774.
      for (const label of additions.runtimeLabels) pairs[label] = exact[label]!;
      pairs["Authenticated as {olyNode0}"] = pairs["Authenticated as"] + " {olyNode0}";
      const status = authenticatedStatus(exact, patterns);
      if (status) pairs["Authenticated · {method}"] = status;
      const ru = readJson<Catalog>(file);
      const en = readJson<Catalog>(enPath);
      const changed = applyOlympusCatalog(en, ru, pairs, {
        patterns, settings: { ...additions.settings4774, ...additions.issueStates }, fallback: additions.nativeFallback,
      });
      this.info("[olympus-l10n] GT Russian catalog overrides: " + changed);
      return JSON.stringify(ru);
    },
  };
}

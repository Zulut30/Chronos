// @effect-diagnostics nodeBuiltinImport:off -- Vite reads the catalogs before JSON is bundled.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite-plus";

type Catalog = Record<string, unknown>;
type Pairs = Record<string, string>;

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8"));
}

// Translate whole messages only. GT assigns IDs before translation and resolves ICU variables
// at render time. Preserve every variable and rich-text node supplied by the English message.
export function applyOlympusCatalog(en: Catalog, ru: Catalog, pairs: Pairs) {
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
  function translate(source: string, variables: string[]): string | undefined {
    if (Object.hasOwn(pairs, source)) return pairs[source];
    const key = source.replace(/\{([\w]+)\}/gu, (value) => {
      variables.push(value);
      return "\0";
    });
    if (/[{}]/u.test(key) || !variables.length) return;
    return normalized.get(key)?.replace(/\0(\d+)\0/gu, (_, index: string) => variables[Number(index)]!);
  }
  let changed = 0;
  for (const [id, source] of Object.entries(en)) {
    let target: unknown;
    if (typeof source === "string") {
      target = translate(source, []);
    } else if (Array.isArray(source)) {
      // The nodes themselves stay intact, including nested markup and variable indexes.
      const nodes: unknown[] = [];
      const message = source.map((part) => {
        if (typeof part === "string") return part;
        nodes.push(part);
        return "{olyNode" + (nodes.length - 1) + "}";
      }).join("");
      if (nodes.length && Array.isArray(ru[id])) {
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
      const runtimePath = resolve(root, "src/chronos/olympus/l10n/runtime-translator.js");
      for (const path of [file, enPath, dictPath, additionsPath, runtimePath]) this.addWatchFile(path);
      const runtime = /^const DICT=(\{.*\});const D=/mu.exec(readFileSync(runtimePath, "utf8"))?.[1];
      if (!runtime) throw new Error("Missing Olympus runtime dictionary");
      const exact = (JSON.parse(runtime) as { exact: Pairs }).exact;
      const tables = readJson<Record<"presentational" | "strict" | "label" | "broad", Pairs>>(dictPath);
      const additions = readJson<{ messages: Pairs; threadDetails: Pairs }>(additionsPath);
      const pairs = {
        ...additions.messages, ...exact, ...tables.broad, ...tables.strict, ...tables.label, ...tables.presentational,
        // 24-thread-details used to replace these labels after the static translator ran.
        ...additions.threadDetails,
      };
      // Native composer override N03 supersedes the earlier static translation.
      const placeholder = "Ask anything. @ files, $ skills, / commands";
      pairs[placeholder] = exact[placeholder]!;
      const ru = readJson<Catalog>(file);
      const changed = applyOlympusCatalog(readJson<Catalog>(enPath), ru, pairs);
      this.info("[olympus-l10n] GT Russian catalog overrides: " + changed);
      return JSON.stringify(ru);
    },
  };
}

// @effect-diagnostics nodeBuiltinImport:off -- Vite build plugin: runs in Node at build time, never in the client.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import type { Plugin } from "vite-plus";

import { englishAsset, englishLiterals, localizeEntryHtml, type EnglishCatalog } from "./englishBundle.ts";
import { shiftMappings } from "./sourcemap.ts";
import { checkCoverage, contextFile, loadTables, newCounts, remaining, tableFiles, tableNames, translateChunk, type Finding } from "./translate.ts";

function assetText(source: string | Uint8Array) {
  return typeof source === "string" ? source : new TextDecoder("utf-8", { fatal: true }).decode(source);
}

export function olympusL10n(): Plugin {
  let root: string;
  let tables: ReturnType<typeof loadTables>;
  let runtime: string;
  let fingerprint: string;
  let english: EnglishCatalog;
  let englishRuntime: string;
  let supportedLocales: string[];

  return {
    name: "chronos:olympus-l10n",
    apply: "build",
    applyToEnvironment: (environment) => environment.name === "client",
    enforce: "post",
    configResolved(config) {
      root = config.root;
    },
    buildStart() {
      const gtConfig = resolve(root, "gt.config.json");
      this.addWatchFile(gtConfig);
      const { defaultLocale, locales } = JSON.parse(readFileSync(gtConfig, "utf8"));
      supportedLocales = [defaultLocale, ...locales];
      const data = resolve(root, "../../chronos/l10n");
      const source = resolve(root, "src/chronos/olympus/l10n");
      const englishDir = resolve(root, "../../chronos/services/ui-language");
      const englishPaths = ["english.mjs", "olympus-en.json"].map(name => resolve(englishDir, name));
      englishRuntime = readFileSync(englishPaths[0]!, "utf8");
      english = JSON.parse(readFileSync(englishPaths[1]!, "utf8"));
      for (const path of englishPaths) this.addWatchFile(path);
      const dictionaryPaths = [...tableFiles, contextFile].map((name) => resolve(data, name));
      const runtimePath = resolve(source, "runtime-translator.js");
      for (const path of [...dictionaryPaths, runtimePath]) this.addWatchFile(path);
      tables = loadTables(data);
      const englishCatalog = resolve(root, "src/i18n/translations/en.json");
      this.addWatchFile(englishCatalog);
      const messages: Record<string, unknown> = JSON.parse(readFileSync(englishCatalog, "utf8"));
      tables.catalogSources = new Set(Object.values(messages).filter((s): s is string => typeof s === "string"));
      runtime = readFileSync(runtimePath, "utf8");
      // generateBundle sees the final minifier spelling. Salt hashes earlier so dictionaries,
      // runtime or rule changes invalidate cached URLs even if upstream JS stays identical.
      const hash = createHash("sha256");
      const rules = ["plugin.ts", "englishBundle.ts", "translate.ts", "contexts.ts", "sourcemap.ts"].map((name) => resolve(source, name));
      for (const path of [...dictionaryPaths, englishCatalog, runtimePath, ...englishPaths, ...rules]) {
        hash.update(readFileSync(path));
      }
      fingerprint = hash.digest("hex");
    },
    augmentChunkHash() {
      return fingerprint;
    },
    generateBundle: {
      order: "post",
      handler(options, bundle) {
        const counts = newCounts(), findings: Finding[] = [];
        const parse = (js: string) => this.parse(js);
        const mainId = resolve(root, "src/main.tsx").replaceAll("\\", "/");
        const imports: Record<string, string> = {};
        let runtimeHosts = 0;
        for (const chunk of Object.values(bundle)) {
          if (chunk.type === "asset" && !chunk.fileName.endsWith(".js")) continue;
          // The extracted Olympus assets are already localized and must retain their original bytes.
          if (chunk.type === "asset" && /^assets\/olympus-(main|markdown|pierre|settings)-[0-9a-f]+\.js$/.test(chunk.fileName)) continue;
          // Catalogs contain IDs and rich message arrays in every language. The Russian
          // JSON has already been processed by olympusCatalog before bundling.
          if (chunk.type === "chunk" && chunk.moduleIds.length > 0 &&
              chunk.moduleIds.every((id) => /\/i18n\/translations\/[^/]+\.json$/u.test(id.replaceAll("\\", "/")))) continue;
          const original = chunk.type === "chunk" ? chunk.code : assetText(chunk.source);
          const { code, edits, unresolved } = translateChunk(original, chunk.fileName, tables, counts, parse);
          // English uses the original T3 chunk. Only chunks containing Chronos copy
          // need an additional source-literal pass. Shared imports keep a single identity.
          const isMain = chunk.type === "chunk" && chunk.moduleIds.some(id => id.replaceAll("\\", "/") === mainId);
          const ownsRussianCopy = chunk.type === "chunk" && chunk.moduleIds.some(id =>
            /\/(?:src\/chronos\/|chronos\/l10n\/artifacts\.ru\.json$|components\/(?:sidebar\/SidebarChrome|settings\/settingsSearch)\.)/u.test(id.replaceAll("\\", "/")));
          const sourceEnglish = ownsRussianCopy ? englishLiterals(original, parse, english) : original;
          if (edits.length || isMain || sourceEnglish !== original) {
            imports["/" + chunk.fileName] = englishAsset(this,
              "en-" + posix.basename(chunk.fileName, ".js"), sourceEnglish.replace(/\/\/# sourceMappingURL=[^\r\n]*$/mu, ""));
          }
          findings.push(...(edits.length ? remaining(code, chunk.fileName, tables, parse) : unresolved));
          if (chunk.type === "asset") {
            if (edits.length) {
              const url = /\/\/# sourceMappingURL=([^\r\n]+)\s*$/u.exec(code)?.[1];
              const inline = url?.match(/^data:application\/json(?:;charset=[^;,]+)?;base64,/iu)?.[0];
              if (url && inline) {
                const map = JSON.parse(Buffer.from(url.slice(inline.length), "base64").toString("utf8"));
                map.mappings = shiftMappings(map.mappings, original, edits);
                const start = code.lastIndexOf(url);
                const encoded = Buffer.from(JSON.stringify(map)).toString("base64");
                chunk.source = code.slice(0, start) + inline + encoded + code.slice(start + url.length);
              } else {
                chunk.source = code;
                const file = url ? posix.join(posix.dirname(chunk.fileName), url) : chunk.fileName + ".map";
                const mapAsset = bundle[file];
                if (mapAsset?.type === "asset") {
                  const map = JSON.parse(assetText(mapAsset.source));
                  map.mappings = shiftMappings(map.mappings, original, edits);
                  mapAsset.source = JSON.stringify(map);
                }
              }
            }
            continue;
          }
          let result = code;
          if (edits.length && options.sourcemap && chunk.map) {
            const map = chunk.map;
            map.mappings = shiftMappings(map.mappings, original, edits);
            chunk.map = map;
            const asset = bundle[chunk.sourcemapFileName ?? chunk.fileName + ".map"];
            if (asset?.type === "asset") asset.source = map.toString();
            if (options.sourcemap === "inline") {
              result = result.replace(/(\/\/# sourceMappingURL=)data:[^\r\n]+/u, () => "//# sourceMappingURL=" + map.toUrl());
            }
          }
          // Match the actual source module even if the dynamic entry is merged or renamed.
          if (chunk.moduleIds.some((id) => id.replaceAll("\\", "/") === mainId)) {
            if (!result.endsWith("\n" + runtime)) result += "\n" + runtime;
            runtimeHosts++;
          }
          if (result !== original) chunk.code = result;
        }
        const setup = englishAsset(this, "chronos-english", [
          "export const imports = " + JSON.stringify(imports) + ";",
          'const map = document.createElement("script"); map.type = "importmap";',
          'map.textContent = JSON.stringify({ imports }); document.head.append(map);',
          englishRuntime,
          "installEnglish(" + JSON.stringify(english) + ");",
        ].join("\n"));
        const html = bundle["index.html"];
        if (html?.type !== "asset") return this.error("Missing Chronos index.html");
        const entryHtml = assetText(html.source);
        if (!entryHtml.includes("window.__chronosInitialLanguage = language;")) {
          html.source = localizeEntryHtml(entryHtml, setup, supportedLocales);
        }
        const strict = process.env.CHRONOS_L10N_STRICT === "1";
        checkCoverage(findings, strict, (message) => this.warn(message));
        const totals = tableNames.map((t) => t + "=" + Object.values(counts[t]).reduce((a, b) => a + b, 0)).join(", ");
        if (runtimeHosts !== 1) {
          const message = "[olympus-l10n] Expected one chunk containing src/main.tsx; found " + runtimeHosts;
          if (strict) this.error(message);
          this.warn(message);
        }
        this.info("[olympus-l10n] Remaining English occurrences: " + findings.length + "; replacements: " + totals);
      },
    },
  };
}

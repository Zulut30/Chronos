// @effect-diagnostics nodeBuiltinImport:off -- Vite build plugin: runs in Node at build time, never in the client.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite-plus";

import { shiftMappings } from "./sourcemap.ts";
import { checkCoverage, loadTables, newCounts, tableFiles, translateChunk, type Counts } from "./translate.ts";

export function olympusL10n(): Plugin {
  let root: string;
  let tables: ReturnType<typeof loadTables>;
  let expected: Counts;
  let runtime: string;
  let fingerprint: string;

  return {
    name: "chronos:olympus-l10n",
    apply: "build",
    applyToEnvironment: (environment) => environment.name === "client",
    enforce: "post",
    configResolved(config) {
      root = config.root;
    },
    buildStart() {
      const data = resolve(root, "../../chronos/l10n");
      const source = resolve(root, "src/chronos/olympus/l10n");
      const dictionaryPaths = tableFiles.map((name) => resolve(data, name));
      const expectedPath = resolve(data, "expected-4774.json");
      const runtimePath = resolve(source, "runtime-translator.js");
      for (const path of [...dictionaryPaths, expectedPath, runtimePath]) this.addWatchFile(path);
      tables = loadTables(data);
      expected = JSON.parse(readFileSync(expectedPath, "utf8"));
      runtime = readFileSync(runtimePath, "utf8");
      // generateBundle sees the final minifier spelling. Salt hashes earlier so dictionaries,
      // runtime or rule changes invalidate cached URLs even if upstream JS stays identical.
      const hash = createHash("sha256");
      const rules = ["plugin.ts", "translate.ts", "sourcemap.ts"].map((name) => resolve(source, name));
      for (const path of [...dictionaryPaths, runtimePath, ...rules]) {
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
        const counts = newCounts();
        const mainId = resolve(root, "src/main.tsx").replaceAll("\\", "/");
        let runtimeHosts = 0;
        for (const chunk of Object.values(bundle)) {
          if (chunk.type !== "chunk") continue;
          const original = chunk.code;
          const { code, keyedCode, passes } = translateChunk(original, tables, counts);
          let result = code;
          if (code !== original && options.sourcemap && chunk.map) {
            const map = chunk.map;
            const keyedMappings = shiftMappings(map.mappings, original, passes[0]);
            map.mappings = shiftMappings(keyedMappings, keyedCode, passes[1]);
            chunk.map = map;
            const asset = bundle[chunk.sourcemapFileName ?? chunk.fileName + ".map"];
            if (asset?.type === "asset") asset.source = map.toString();
            if (options.sourcemap === "inline") {
              result = result.replace(/(\/\/# sourceMappingURL=)data:[^\r\n]+/u, () => "//# sourceMappingURL=" + map.toUrl());
            }
          }
          // Match the actual source module even if the dynamic entry is merged or renamed.
          if (chunk.moduleIds.some((id) => id.replaceAll("\\", "/") === mainId)) {
            result += "\n" + runtime;
            runtimeHosts++;
          }
          if (result !== original) chunk.code = result;
        }
        const strict = process.env.CHRONOS_L10N_STRICT === "1";
        const totals = checkCoverage(counts, expected, strict, (message) => this.warn(message));
        if (runtimeHosts !== 1) {
          const message = "[olympus-l10n] Expected one chunk containing src/main.tsx; found " + runtimeHosts;
          if (strict) this.error(message);
          this.warn(message);
        }
        this.info("[olympus-l10n] " + totals);
      },
    },
  };
}

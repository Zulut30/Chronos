// @effect-diagnostics nodeBuiltinImport:off -- Vite build plugin: runs in Node at build time, never in the client.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite-plus";
import { assemblePrologue, standaloneFeature } from "./featureAssets.ts";

// 93-chat-panels constructs absolute URLs at runtime, including in unbundled dev.
const panelShims = new Map([
  ["entities-BYt4Kx9w.js", "entities"],
  ["rightPanelStore-BKC7Sf3u.js", "rightPanelStore"],
  ["react-BP46yLMB.js", "react"],
  ["jsx-runtime-BQExFN_X.js", "jsx-runtime"],
]);

const richFile = "88-rich-markdown.chat.js";
const rawPrefix = "chronos-olympus:";
const normalize = (id: string) => id.replaceAll("\\", "/");

export function olympusFeatures(): Plugin {
  const directory = fileURLToPath(new URL(".", import.meta.url));
  let bundled: boolean;
  const assets = new Map<string, string>();

  return {
    name: "chronos:olympus-features",
    enforce: "pre",
    configResolved(config) {
      bundled = config.command === "build" || config.experimental.bundledDev === true;
    },
    buildStart() {
      if (!bundled) return;
      const read = (path: string) => {
        const absolute = resolve(directory, path);
        this.addWatchFile(absolute);
        return readFileSync(absolute, "utf8");
      };
      // The release prepended these files with occasional extra line feeds. Keep both
      // the execution order and those separators in the source prologue's import list.
      const sources = [
        ["main", assemblePrologue(read("prologue.ts"), read)],
        ["pierre", standaloneFeature("15-lang-icons.js", read("features/15-lang-icons.js"))],
        ["markdown", standaloneFeature(richFile, read("features/" + richFile))],
      ] as const;
      for (const [key, source] of sources) {
        // An ESM asset stays outside both the JS compiler and the post-build translator.
        const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
        const name = `olympus-${key}-${hash}.js`;
        this.emitFile({ type: "asset", fileName: "assets/" + name, source });
        assets.set(rawPrefix + key, "./" + name);
      }
      for (const [file, shim] of panelShims) {
        this.emitFile({
          type: "chunk",
          id: resolve(directory, "shims", shim + ".ts"),
          fileName: "assets/" + file,
          preserveSignature: "strict",
        });
      }
    },
    resolveId(source, importer) {
      const parent = normalize(importer ?? "");
      if (
        source === "./olympusRichMarkdown.ts" &&
        (parent.endsWith("/packages/shared/src/markdownPipeline.ts") ||
          parent.endsWith("/packages/shared/src/markdownHast.ts"))
      ) {
        return bundled
          ? { id: rawPrefix + "markdown", external: true }
          : resolve(directory, "features", richFile);
      }
      if (
        bundled &&
        parent.endsWith("/apps/web/src/main.tsx") &&
        source === "./chronos/olympus/prologue"
      ) {
        return { id: rawPrefix + "main", external: true, moduleSideEffects: true };
      }
      if (
        bundled &&
        parent.endsWith("/apps/web/src/pierre-icons.ts") &&
        source === "./chronos/olympus/features/15-lang-icons.js"
      ) {
        return { id: rawPrefix + "pierre", external: true, moduleSideEffects: true };
      }
      if (!bundled && source.startsWith("/assets/")) {
        const shim = panelShims.get(source.slice("/assets/".length));
        if (shim) return resolve(directory, "shims", shim + ".ts");
      }
    },
    transform(code, id) {
      if (bundled) return;
      const file = /\/chronos\/olympus\/features\/([\w.-]+\.js)$/.exec(normalize(id))?.[1];
      if (!file) return;
      const wrapped = standaloneFeature(file, code);
      if (wrapped !== code) return { code: wrapped, map: null };
    },
    outputOptions(options) {
      if (!bundled) return;
      const previous = options.paths;
      return {
        ...options,
        paths: (id) =>
          assets.get(id) ?? (typeof previous === "function" ? previous(id) : previous?.[id]) ?? id,
      };
    },
  };
}

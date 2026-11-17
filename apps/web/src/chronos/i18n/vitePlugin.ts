// chronos: routes the web app's own JSX through jsxRuntime.ts / jsxDevRuntime.ts so interface text
// is localized as elements are created (localizeElement.ts). Dependencies and the runtime files
// themselves keep React's runtime. Off under Vitest, so upstream tests see upstream output.
// See chronos/README.md.
import type { Plugin } from "vite-plus";

const RUNTIMES: Readonly<Record<string, string>> = {
  "react/jsx-runtime": "jsxRuntime.ts",
  "react/jsx-dev-runtime": "jsxDevRuntime.ts",
};

export function chronosL10nPlugin(): Plugin {
  let sourceDir = "";
  let runtimeDir = "";
  const enabled = !process.env.VITEST;
  return {
    name: "chronos:l10n-jsx",
    enforce: "pre",
    configResolved(config) {
      const root = config.root.replaceAll("\\", "/").replace(/\/$/, "");
      sourceDir = `${root}/src/`;
      runtimeDir = `${root}/src/chronos/i18n/`;
    },
    resolveId(source, importer) {
      const runtime = RUNTIMES[source];
      if (!enabled || !runtime || !importer) return null;
      const from = importer.replaceAll("\\", "/");
      if (!from.startsWith(sourceDir) || from.startsWith(runtimeDir)) return null;
      return `${runtimeDir}${runtime}`;
    },
  };
}

import type * as Path from "effect/Path";

// electron-builder resolves staged paths relative to its app directory.
// Source resources live in the checkout and need absolute paths.
export function chronosResources(repoRoot: string, path: Path.Path) {
  return [
    { from: "apps/desktop/prod-resources/chronos-pc", to: "chronos-pc" },
    { from: path.join(repoRoot, "chronos/services"), to: "chronos-services", filter: ["**/*", "!**/*.test.mjs"] },
    { from: path.join(repoRoot, "chronos/brand/themes/olympus.json"), to: "chronos-themes/olympus.json" },
  ];
}

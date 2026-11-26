import * as NodePath from "node:path";

// electron-builder resolves staged paths relative to its app directory.
// Source resources live in the checkout and need absolute paths.
export function chronosResources(repoRoot: string) {
  return [
    { from: "apps/desktop/prod-resources/chronos-pc", to: "chronos-pc" },
    { from: NodePath.join(repoRoot, "chronos/services"), to: "chronos-services", filter: ["**/*", "!**/*.test.mjs"] },
    { from: NodePath.join(repoRoot, "chronos/brand/themes/olympus.json"), to: "chronos-themes/olympus.json" },
  ];
}

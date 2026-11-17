import { CHRONOS_RICH_COLORS } from "@t3tools/shared/markdownPipeline";
export const chronosRichColorCss = [
  ":root{",
  ...Object.entries(CHRONOS_RICH_COLORS).map(
    ([name, colors]) =>
      `--chronos-c-${name}:${colors[0]};--chronos-bg-${name}:color-mix(in srgb,${colors[0]} 16%,transparent);`,
  ),
  "}:root.dark{",
  ...Object.entries(CHRONOS_RICH_COLORS).map(
    ([name, colors]) =>
      `--chronos-c-${name}:${colors[1]};--chronos-bg-${name}:color-mix(in srgb,${colors[1]} 26%,transparent);`,
  ),
  "}",
].join("");

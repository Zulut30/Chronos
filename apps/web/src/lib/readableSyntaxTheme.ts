import { getResolvedOrResolveTheme, registerCustomTheme, type DiffsTheme } from "@pierre/diffs";

/** pierre-light with every syntax color darkened until it reads on every light code surface. */
export const READABLE_LIGHT_THEME_NAME = "t3-light";
/** pierre-dark with every syntax color lightened until it reads on every dark code surface. */
export const READABLE_DARK_THEME_NAME = "t3-dark";

const MIN_CONTRAST = 4.5;
// The darkest light code surface is a changed word on a deleted line (#f8d3d4, luminance
// 0.71), rounded down for margin.
const DARKEST_SURFACE_LUMINANCE = 0.69;
// The lightest dark code surface (raised Graphite/Night code and diff emphasis), rounded up for margin.
const LIGHTEST_DARK_SURFACE_LUMINANCE = 0.028;

function channelLuminance(channel: number): number {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function contrastOnLightCode(rgb: readonly [number, number, number]): number {
  const [r, g, b] = rgb.map(channelLuminance) as [number, number, number];
  return (DARKEST_SURFACE_LUMINANCE + 0.05) / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05);
}

function contrastOnDarkCode(rgb: readonly [number, number, number]): number {
  const [r, g, b] = rgb.map(channelLuminance) as [number, number, number];
  return (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05) / (LIGHTEST_DARK_SURFACE_LUMINANCE + 0.05);
}

/** Darkens a #rrggbb(aa) color in steps that keep its hue until it reads on light code. */
export function readableOnLightCode(color: string, minContrast = MIN_CONTRAST): string {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color);
  if (!match) return color;
  let rgb = [0, 2, 4].map((start) => Number.parseInt(match[1]!.slice(start, start + 2), 16)) as [
    number,
    number,
    number,
  ];
  if (contrastOnLightCode(rgb) >= minContrast) return color;
  while (contrastOnLightCode(rgb) < minContrast) {
    rgb = rgb.map((channel) => Math.floor(channel * 0.96)) as [number, number, number];
  }
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}${match[2] ?? ""}`;
}

/** Lightens a #rrggbb(aa) color in steps that keep its hue until it reads on dark code. */
export function readableOnDarkCode(color: string, minContrast = MIN_CONTRAST): string {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color);
  if (!match) return color;
  let rgb = [0, 2, 4].map((start) => Number.parseInt(match[1]!.slice(start, start + 2), 16)) as [
    number,
    number,
    number,
  ];
  if (contrastOnDarkCode(rgb) >= minContrast) return color;
  while (contrastOnDarkCode(rgb) < minContrast) {
    rgb = rgb.map((channel) =>
      Math.min(255, Math.ceil(channel + (255 - channel) * 0.04)),
    ) as [number, number, number];
  }
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}${match[2] ?? ""}`;
}

type ZedTheme = NonNullable<DiffsTheme["zed"]>;

// Pairs that differ only in lightness would merge at one floor. The darker color of each pair
// goes further, keeping pierre-light's order: numbers stay darker than operators, punctuation
// darker than comments, and decorators darker than property names.
const FURTHER_COLORS = new Set(["#1ca1c7", "#636363", "#1a85d4"]);
const FURTHER_MIN_CONTRAST = 6;
// Keep pierre-dark comments (#737373) lighter than punctuation (#636363) above the 4.5:1 floor.
const DARK_LIGHTER_COLORS = new Set(["#737373"]);
const DARK_LIGHTER_MIN_CONTRAST = 5.4;

/** The t3-light color for a pierre-light syntax color. */
export function readableSyntaxColor(color: string): string {
  return readableOnLightCode(
    color,
    FURTHER_COLORS.has(color.toLowerCase()) ? FURTHER_MIN_CONTRAST : MIN_CONTRAST,
  );
}

/** The t3-dark color for a pierre-dark syntax color. */
export function readableDarkSyntaxColor(color: string): string {
  return readableOnDarkCode(
    color,
    DARK_LIGHTER_COLORS.has(color.toLowerCase()) ? DARK_LIGHTER_MIN_CONTRAST : MIN_CONTRAST,
  );
}

function withReadableSyntax(
  theme: ZedTheme,
  name: string,
  mapColor: (color: string) => string,
): ZedTheme {
  const syntax = Object.fromEntries(
    Object.entries(theme.style.syntax ?? {}).map(([scope, style]) => [
      scope,
      typeof style === "string"
        ? mapColor(style)
        : style.color
          ? { ...style, color: mapColor(style.color) }
          : style,
    ]),
  );
  return { ...theme, name, style: { ...theme.style, syntax } };
}

// Themes resolve on the main thread and reach the diff workers already resolved.
registerCustomTheme(
  READABLE_LIGHT_THEME_NAME,
  async () => {
    const base = await getResolvedOrResolveTheme("pierre-light", "highlights");
    if (!base.zed) throw new Error("pierre-light has no Highlights palette");
    return withReadableSyntax(base.zed, READABLE_LIGHT_THEME_NAME, readableSyntaxColor);
  },
  "zed",
);

registerCustomTheme(
  READABLE_DARK_THEME_NAME,
  async () => {
    const base = await getResolvedOrResolveTheme("pierre-dark", "highlights");
    if (!base.zed) throw new Error("pierre-dark has no Highlights palette");
    return withReadableSyntax(base.zed, READABLE_DARK_THEME_NAME, readableDarkSyntaxColor);
  },
  "zed",
);

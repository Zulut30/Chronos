import { describe, expect, it } from "vite-plus/test";

import {
  readableDarkSyntaxColor,
  readableOnDarkCode,
  readableOnLightCode,
  readableSyntaxColor,
} from "./readableSyntaxTheme";

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((start) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  return (luminance(background) + 0.05) / (luminance(foreground) + 0.05);
}

// pierre-light's faintest syntax colors: yellow, cyan, orange, teal, green, pink.
const PIERRE_LIGHT_FAINT = ["#d5a910", "#08c0ef", "#d5901c", "#1ca1c7", "#199f43", "#d32a61"];
// Light code surfaces: the code background, added and deleted lines, and changed words on each.
const LIGHT_CODE_SURFACES = ["#fcfcfc", "#ecf9f4", "#fef0f0", "#ccecdf", "#f8d3d4"];

describe("readableOnLightCode", () => {
  it("brings pierre-light's faint colors to 4.5:1 on every light code surface", () => {
    for (const color of PIERRE_LIGHT_FAINT) {
      for (const surface of LIGHT_CODE_SURFACES) {
        expect(contrast(readableOnLightCode(color), surface)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps tokens that differed only in lightness apart, in pierre-light's order", () => {
    // [lighter, darker] in pierre-light: comment/punctuation, operator/number, property/decorator.
    for (const [lighter, darker] of [
      ["#737373", "#636363"],
      ["#08c0ef", "#1ca1c7"],
      ["#009fff", "#1a85d4"],
    ] as const) {
      expect(luminance(readableSyntaxColor(lighter))).toBeGreaterThan(
        luminance(readableSyntaxColor(darker)) + 0.02,
      );
    }
  });

  it("leaves colors that already read unchanged", () => {
    expect(readableOnLightCode("#693acf")).toBe("#693acf");
    expect(readableOnLightCode("#0a0a0a")).toBe("#0a0a0a");
  });

  it("keeps an alpha suffix and ignores non-hex values", () => {
    expect(readableOnLightCode("#d5a91080")).toMatch(/80$/);
    expect(readableOnLightCode("var(--x)")).toBe("var(--x)");
  });
});

// Dark code surfaces: T3, Graphite code/card/inline code, and classic Night Olympus.
const DARK_CODE_SURFACES = ["#090909", "#0d0f12", "#101216", "#1d2229", "#242a33", "#0e1e3e"];

function darkContrast(foreground: string, background: string): number {
  return (luminance(foreground) + 0.05) / (luminance(background) + 0.05);
}

describe("readableOnDarkCode", () => {
  it("brings pierre-dark's faint comments and punctuation to 4.5:1 on every dark code surface", () => {
    for (const color of ["#636363", "#737373"]) {
      const lifted = readableDarkSyntaxColor(color);
      for (const surface of DARK_CODE_SURFACES) {
        expect(darkContrast(lifted, surface)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps comments lighter than punctuation above the 4.5:1 floor", () => {
    expect(luminance(readableDarkSyntaxColor("#737373"))).toBeGreaterThan(
      luminance(readableDarkSyntaxColor("#636363")) + 0.02,
    );
  });

  it("leaves already readable dark syntax colors unchanged", () => {
    expect(readableOnDarkCode("#e8ecf2")).toBe("#e8ecf2");
    expect(readableOnDarkCode("#ff678d")).toBe("#ff678d");
  });

  it("keeps an alpha suffix and ignores non-hex values", () => {
    expect(readableOnDarkCode("#63636380")).toMatch(/80$/);
    expect(readableOnDarkCode("var(--x)")).toBe("var(--x)");
  });
});

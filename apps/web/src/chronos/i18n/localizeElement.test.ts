import { isValidElement, type ReactElement } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import { brandChronosText, loadChronosCatalog, translateChronosText } from "./catalog";
import { chronosSupportedLocales } from "./locales";
import { localizeElementProps } from "./localizeElement";

type TextElement = ReactElement<{ source: string; text: string }>;

const setLang = (lang: string) => {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { documentElement: { lang } },
  });
};

const props = (value: unknown) => value as Record<string, unknown>;
const text = (value: unknown) => {
  expect(isValidElement(value)).toBe(true);
  return (value as TextElement).props.text;
};

function Component() {
  return null;
}

beforeAll(async () => {
  await loadChronosCatalog("ru");
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "document");
});

describe("Chronos Russian catalog", () => {
  it("translates exact strings and keeps surrounding whitespace", () => {
    expect(translateChronosText("Settings")).toBe("Настройки");
    expect(translateChronosText(" Settings ")).toBe(" Настройки ");
    expect(translateChronosText("no such interface string")).toBeNull();
  });

  it("fills patterns, translating captured interface words", () => {
    expect(translateChronosText("5m ago")).toBe("5 мин назад");
  });

  it("names the product Chronos but leaves T3's mobile app and services", () => {
    expect(brandChronosText("T3 Code will restart.")).toBe("Chronos will restart.");
    expect(brandChronosText("T3 Code app for iPhone and Android")).toBe(
      "T3 Code app for iPhone and Android",
    );
    expect(brandChronosText("Sign in to T3 Connect")).toBe("Sign in to T3 Connect");
  });

  it("offers English and Russian only", () => {
    expect(chronosSupportedLocales(["en", "de", "ru", "zh"])).toEqual(["en", "ru"]);
  });
});

describe("localizeElementProps", () => {
  it("leaves English text alone, apart from the product name", () => {
    setLang("en");
    const source = { children: "Settings", title: "Settings" };
    expect(localizeElementProps("button", source)).toBe(source);
    expect(text(props(localizeElementProps("p", { children: "T3 Code is ready" })).children)).toBe(
      "Chronos is ready",
    );
  });

  it("translates host text children and text attributes in Russian", () => {
    setLang("ru");
    const result = props(
      localizeElementProps("button", {
        "aria-label": "Settings",
        children: ["Settings", 3],
        "data-value": "Settings",
      }),
    );
    expect(result["aria-label"]).toBe("Настройки");
    expect(result["data-value"]).toBe("Settings");
    const children = result.children as unknown[];
    expect(text(children[0])).toBe("Настройки");
    expect(children[1]).toBe(3);
  });

  it("hands components plain strings", () => {
    setLang("ru");
    const result = props(localizeElementProps(Component, { children: "Settings", label: "x" }));
    expect(result.children).toBe("Настройки");
    expect(result.label).toBe("x");
  });

  it("keeps user content as written", () => {
    setLang("ru");
    for (const [type, source] of [
      ["code", { children: "Settings" }],
      ["span", { dir: "auto", children: "Settings" }],
      ["div", { className: "chat-markdown w-full", children: "Settings" }],
      [Component, { dir: "ltr", children: "Settings" }],
    ] as const) {
      expect(localizeElementProps(type, source)).toBe(source);
    }
    const nested = props(localizeElementProps("pre", { children: ["Settings", "x"] }));
    expect(isValidElement(nested.children)).toBe(true);
  });

  it("keeps plain strings where React only accepts strings", () => {
    setLang("ru");
    expect(props(localizeElementProps("option", { children: "Settings" })).children).toBe(
      "Настройки",
    );
  });
});

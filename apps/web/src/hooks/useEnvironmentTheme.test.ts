import type { EnvironmentTheme } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const publishedThemes = vi.hoisted(() => ({
  atom: null as unknown as import("effect/reactivity").Atom.Writable<ReadonlyArray<EnvironmentTheme> | null>,
}));
vi.mock(import("../state/server"), async () => {
  const { Atom } = await import("effect/reactivity");
  publishedThemes.atom = Atom.make<ReadonlyArray<EnvironmentTheme> | null>([]);
  return { themeServerEnvironmentThemesAtom: publishedThemes.atom } as never;
});
const refreshTheme = vi.hoisted(() => vi.fn());
vi.mock(import("./useTheme"), () => ({ refreshTheme }) as never);

import { appAtomRegistry } from "../rpc/atomRegistry";
import {
  CUSTOM_THEMES_STORAGE_KEY,
  ENVIRONMENT_THEMES_STORAGE_KEY,
  THEME_HALVES_STORAGE_KEY,
  getThemeDefinition,
  migrateThemeSelections,
  installCustomTheme,
  invalidateCustomThemes,
  publishedThemeDefinitions,
} from "../themePalette";
import { startEnvironmentThemeRepaint } from "./useEnvironmentTheme";

const NIGHTFALL_THEME = {
  id: "nightfall",
  name: "Nightfall",
  appearance: "dark",
  canvas: "#1a1b26",
  accent: "#7aa2f7",
} as const;

afterEach(() => {
  appAtomRegistry.set(publishedThemes.atom, []);
});

describe("environment themes", () => {
  it("drops published themes with reserved ids", () => {
    const definitions = publishedThemeDefinitions([
      NIGHTFALL_THEME,
      { ...NIGHTFALL_THEME, id: "t3-iris", name: "Impostor Iris" },
      { ...NIGHTFALL_THEME, id: "ocean", name: "Impostor Ocean" },
      { ...NIGHTFALL_THEME, id: "dark", name: "Impostor Dark" },
    ]);

    expect(definitions.map((definition) => definition.id)).toEqual(["nightfall"]);
  });

  it("drops published palettes with no usable colors", () => {
    const theme = { id: "invalid", name: "Invalid", appearance: "dark" } as const;
    const definitions = publishedThemeDefinitions([
      { ...theme, colors: { canvas: "not-a-color" } },
      { ...theme, id: "unknown-roles", colors: { futureRole: "#ffffff" } },
      {
        ...theme,
        id: "ignored-variant",
        colors: { canvas: "not-a-color" },
        variants: { dark: { canvas: "#112233" } },
      },
    ]);

    expect(definitions).toEqual([]);
  });

  it("keeps seeds, partial palettes, and usable alternate appearances", () => {
    const theme = { name: "Shared", appearance: "dark" } as const;
    const definitions = publishedThemeDefinitions([
      NIGHTFALL_THEME,
      {
        ...theme,
        id: "partial",
        colors: { canvas: "not-a-color", text: "#ffffff", futureRole: "#ffffff" },
      },
      {
        ...theme,
        id: "light-variant",
        colors: { canvas: "not-a-color" },
        variants: { light: { canvas: "#eff1f5" } },
      },
    ]);

    expect(definitions.map((definition) => definition.id)).toEqual([
      "nightfall",
      "partial",
      "light-variant",
    ]);
  });

  // Routes without the old root sync component (/connect, prompt-link landings) never saw them.
  it("resolves published themes without a React subscriber mounted", () => {
    appAtomRegistry.set(publishedThemes.atom, [NIGHTFALL_THEME]);
    expect(getThemeDefinition("nightfall")?.label).toBe("Nightfall");

    appAtomRegistry.set(publishedThemes.atom, [{ ...NIGHTFALL_THEME, name: "Nightfall 2" }]);
    expect(getThemeDefinition("nightfall")?.label).toBe("Nightfall 2");
  });

  it("lets a theme the user saved win an id collision", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
      },
    });
    invalidateCustomThemes();
    try {
      appAtomRegistry.set(publishedThemes.atom, [NIGHTFALL_THEME]);
      expect(getThemeDefinition("nightfall")?.label).toBe("Nightfall");
      const environment = getThemeDefinition("nightfall");
      if (!environment) throw new Error("expected the published theme");
      installCustomTheme({ ...environment, label: "My Nightfall" });

      expect(getThemeDefinition("nightfall")?.label).toBe("My Nightfall");
    } finally {
      vi.unstubAllGlobals();
      invalidateCustomThemes();
    }
    expect(getThemeDefinition("nightfall")?.label).toBe("Nightfall");
  });

  it("migrates both selected halves before removing a redundant local palette", () => {
    const olympus: EnvironmentTheme = {
      ...NIGHTFALL_THEME, id: "olympus", name: "Olympus", variants: { light: { canvas: "#eeeeee" } },
    };
    const original = publishedThemeDefinitions([olympus])[0]!;
    const edited = { ...original, id: "named-copy", colors: { ...original.colors, canvas: "#012345" } };
    const duplicate = { ...original, variants: undefined, id: "old-import", label: "Imported Graphite" };
    const other = { id: "future-format", unknown: true };
    const store = new Map([
      [ENVIRONMENT_THEMES_STORAGE_KEY, JSON.stringify([original])],
      [CUSTOM_THEMES_STORAGE_KEY, JSON.stringify([edited, duplicate, other])],
      ["t3code:theme", duplicate.id],
      [THEME_HALVES_STORAGE_KEY, JSON.stringify({ light: duplicate.id, dark: duplicate.id })],
    ]);
    vi.stubGlobal("window", { localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    } });
    invalidateCustomThemes();
    appAtomRegistry.set(publishedThemes.atom, null);
    const stop = startEnvironmentThemeRepaint();
    try {
      expect(JSON.parse(store.get(CUSTOM_THEMES_STORAGE_KEY)!)).toHaveLength(3);
      appAtomRegistry.set(publishedThemes.atom, [olympus]);
      expect(JSON.parse(store.get(CUSTOM_THEMES_STORAGE_KEY)!)).toEqual([edited, other]);
      for (let restart = 0; restart < 2; restart++) {
        migrateThemeSelections();
        expect(store.get("t3code:theme")).toBe("olympus");
        expect(JSON.parse(store.get(THEME_HALVES_STORAGE_KEY)!)).toEqual({ light: "olympus", dark: "olympus" });
        expect(JSON.parse(store.get(CUSTOM_THEMES_STORAGE_KEY)!)).toEqual([edited, other]);
        invalidateCustomThemes();
      }
    } finally {
      stop();
      vi.unstubAllGlobals();
      invalidateCustomThemes();
    }
  });

  it("keeps the last published palette while the server has not answered", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
      },
    });
    const stop = startEnvironmentThemeRepaint();
    try {
      appAtomRegistry.set(publishedThemes.atom, [NIGHTFALL_THEME]);
      appAtomRegistry.set(publishedThemes.atom, null);
      expect(getThemeDefinition("nightfall")?.label).toBe("Nightfall");

      appAtomRegistry.set(publishedThemes.atom, []);
      appAtomRegistry.set(publishedThemes.atom, null);
      expect(getThemeDefinition("nightfall")).toBeNull();
    } finally {
      stop();
      vi.unstubAllGlobals();
    }
  });

  it("repaints when the environment publishes themes nothing has read yet", async () => {
    vi.resetModules();
    const { appAtomRegistry: registry } = await import("../rpc/atomRegistry");
    const { startEnvironmentThemeRepaint } = await import("./useEnvironmentTheme");
    const stop = startEnvironmentThemeRepaint();
    try {
      registry.set(publishedThemes.atom, [NIGHTFALL_THEME]);
      expect(refreshTheme).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });
});

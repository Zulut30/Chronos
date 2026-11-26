import { THEME_COLOR_ROLES, type ThemeDefinition } from "@t3tools/shared/themePalettes";

type Source = readonly ThemeDefinition[];
const names = (theme: ThemeDefinition) => theme.label.trim().normalize("NFKC").toLowerCase();
const modes = ["light", "dark"] as const;

// Compare what each half paints. File ids, collection metadata, base-half order and JSON
// property order do not change the palette. Keep distinct artwork and stylesheets.
export function createThemeLibrary(
  stock: Source, custom: Source, published: Source, normalizeColor: (color: string) => string | null,
  backgrounds: ReadonlyMap<string, string>,
) {
  const ids = new Map<string, ThemeDefinition>();
  const canonical: ThemeDefinition[] = [];
  const colors = new Map<ThemeDefinition, string>();
  function palette(theme: ThemeDefinition) {
    let value = colors.get(theme);
    if (value === undefined) {
      value = JSON.stringify(modes.map(mode => {
        const half = mode === theme.appearance ? theme.colors : theme.variants?.[mode];
        return half && THEME_COLOR_ROLES.map(role => normalizeColor(half[role]) ?? half[role]);
      }));
      colors.set(theme, value);
    }
    return value;
  }
  function sameContent(a: ThemeDefinition, b: ThemeDefinition) {
    return (a.css ?? "").replaceAll("\r\n", "\n") === (b.css ?? "").replaceAll("\r\n", "\n") &&
      backgrounds.get(a.id) === backgrounds.get(b.id) && palette(a) === palette(b);
  }
  function sameName(a: ThemeDefinition, b: ThemeDefinition) {
    return names(a) === names(b) && modes.every(mode =>
      Boolean(mode === a.appearance || a.variants?.[mode]) === Boolean(mode === b.appearance || b.variants?.[mode]));
  }
  function add(theme: ThemeDefinition) {
    if (ids.has(theme.id)) return;
    const survivor = canonical.find(other => sameName(other, theme) || sameContent(other, theme));
    ids.set(theme.id, survivor ?? theme);
    if (!survivor) canonical.push(theme);
  }
  stock.forEach(add);
  // The named Olympus theme serves both halves, including Graphite. An explicitly
  // edited local definition with the same ID still takes precedence over the server.
  const olympus = custom.find(theme => theme.id === "olympus") ?? published.find(theme => theme.id === "olympus");
  if (olympus) add(olympus);
  custom.forEach(add);
  published.forEach(add);
  return {
    ids,
    custom: custom.filter(theme => ids.get(theme.id) === theme),
    published: published.filter(theme => ids.get(theme.id) === theme),
    matchingContent: (theme: ThemeDefinition) => canonical.find(other => sameContent(other, theme)),
    matchingName: (theme: ThemeDefinition) => canonical.find(other => sameName(other, theme)),
  };
}

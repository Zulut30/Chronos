import { THEME_COLOR_ROLES, type ThemeDefinition } from "@t3tools/shared/themePalettes";

type Source = readonly ThemeDefinition[];
const names = (theme: ThemeDefinition) => theme.label.trim().normalize("NFKC").replace(/\s+/gu, " ").toLowerCase();
const modes = ["light", "dark"] as const;

// Compare what each half paints. File ids, collection metadata, base-half order and JSON
// property order do not change the palette. Keep distinct artwork and stylesheets.
export function createThemeLibrary(
  stock: Source, custom: Source, published: Source, normalizeColor: (color: string) => string | null,
  backgrounds: ReadonlyMap<string, string>,
) {
  const ids = new Map<string, ThemeDefinition>();
  const canonical: ThemeDefinition[] = [];
  const colors = new Map<ThemeDefinition, readonly (string | null)[]>();
  const normalized = new Map<string, string>();
  function color(raw: string) {
    const cached = normalized.get(raw);
    if (cached !== undefined) return cached;
    const value = normalizeColor(raw) ?? raw;
    normalized.set(raw, value);
    return value;
  }
  function palette(theme: ThemeDefinition) {
    let value = colors.get(theme);
    if (value === undefined) {
      value = modes.map(mode => {
        const half = mode === theme.appearance ? theme.colors : theme.variants?.[mode];
        return half ? JSON.stringify(THEME_COLOR_ROLES.map(role => color(half[role]))) : null;
      });
      colors.set(theme, value);
    }
    return value;
  }
  function sameContent(a: ThemeDefinition, b: ThemeDefinition) {
    return (a.css ?? "").replaceAll("\r\n", "\n") === (b.css ?? "").replaceAll("\r\n", "\n") &&
      backgrounds.get(a.id) === backgrounds.get(b.id) &&
      palette(b).every((half, index) => half === null || half === palette(a)[index]);
  }
  function sameName(a: ThemeDefinition, b: ThemeDefinition) {
    return names(a) === names(b) && modes.every(mode =>
      !(mode === b.appearance || b.variants?.[mode]) || mode === a.appearance || !!a.variants?.[mode]);
  }
  function add(theme: ThemeDefinition) {
    if (ids.has(theme.id)) return;
    const survivor = canonical.find(other => sameName(other, theme) || sameContent(other, theme));
    ids.set(theme.id, survivor ?? theme);
    if (!survivor) canonical.push(theme);
  }
  for (const theme of stock) {
    ids.set(theme.id, theme);
    canonical.push(theme);
  }
  // The named Olympus theme serves both halves, including Graphite. An explicitly
  // edited local definition with the same ID still takes precedence over the server.
  const olympus = custom.find(theme => theme.id === "olympus") ?? published.find(theme => theme.id === "olympus");
  if (olympus) add(olympus);
  const localIds = new Set(custom.map(theme => theme.id));
  const themes = [...custom, ...published.filter(theme => !localIds.has(theme.id))];
  // A single imported Graphite half may reference the corresponding half of Olympus.
  // Resolve pairs first so a single half never displaces a pair with two usable palettes.
  for (const theme of themes) if (theme.variants?.light || theme.variants?.dark) add(theme);
  for (const theme of themes) add(theme);
  return {
    ids,
    custom: custom.filter(theme => ids.get(theme.id) === theme),
    published: published.filter(theme => ids.get(theme.id) === theme),
    matchingContent: (theme: ThemeDefinition) => canonical.find(other => sameContent(other, theme)),
    matchingName: (theme: ThemeDefinition) => canonical.find(other => sameName(other, theme)),
  };
}

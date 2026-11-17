// chronos: the built-in Olympus theme (day palette + night variant) and its first-run
// default. Theme sources live in chronos/theme; chronos/scripts/sync-theme.mjs refreshes
// olympus.theme.json from them. See chronos/README.md.
import type { EnvironmentTheme } from "@t3tools/contracts";

import olympusThemeFile from "./olympus.theme.json";

export const CHRONOS_DEFAULT_THEME_ID = "olympus";

/** Same shape as a theme published with `t3 theme set`, so it renders identically. */
export const CHRONOS_OLYMPUS_THEME_FILE = {
  ...olympusThemeFile,
  id: CHRONOS_DEFAULT_THEME_ID,
} as unknown as EnvironmentTheme;

const SEEDED_STORAGE_KEY = "chronos:default-theme-seeded";
const THEME_STORAGE_KEY = "t3code:theme";
const THEME_HALVES_STORAGE_KEY = "t3code:theme-halves:v1";
const THEME_APPEARANCE_MODE_STORAGE_KEY = "t3code:theme-appearance-mode";

/**
 * Selects Olympus, following the system's light/dark appearance, once per profile.
 * A theme the user already picked (whole theme or light/dark mix) is left alone.
 */
export function seedChronosDefaultTheme(): void {
  if (typeof window === "undefined") return;
  try {
    const storage = window.localStorage;
    if (storage.getItem(SEEDED_STORAGE_KEY) !== null) return;
    storage.setItem(SEEDED_STORAGE_KEY, "1");
    if (storage.getItem(THEME_STORAGE_KEY) !== null) return;
    if (storage.getItem(THEME_HALVES_STORAGE_KEY) !== null) return;
    storage.setItem(THEME_STORAGE_KEY, CHRONOS_DEFAULT_THEME_ID);
    if (storage.getItem(THEME_APPEARANCE_MODE_STORAGE_KEY) === null) {
      storage.setItem(THEME_APPEARANCE_MODE_STORAGE_KEY, "system");
    }
  } catch {
    // Without storage the app keeps its stock default.
  }
}

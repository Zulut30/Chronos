import { useSyncExternalStore } from "react";

import { subscribeAtomChanges } from "../rpc/atomRegistry";
import {
  environmentThemeDefinitionsAtom,
  storePublishedEnvironmentThemes,
  getPublishedThemes,
  migrateThemeSelections,
  subscribeToCustomThemes,
  type ThemeDefinition,
} from "../themePalette";
import { refreshTheme } from "./useTheme";

export function useEnvironmentThemeDefinitions(): ReadonlyArray<ThemeDefinition> {
  return useSyncExternalStore(subscribeToCustomThemes, getPublishedThemes, getPublishedThemes);
}

/**
 * The palette is painted from a snapshot taken when the theme last changed, so new colors
 * only land if the active theme is re-applied.
 */
export function startEnvironmentThemeRepaint(): () => void {
  migrateThemeSelections();
  return subscribeAtomChanges(environmentThemeDefinitionsAtom, (definitions) => {
    migrateThemeSelections();
    storePublishedEnvironmentThemes(definitions);
    refreshTheme({ preservePreview: true });
  });
}

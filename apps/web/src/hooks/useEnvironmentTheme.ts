import { useSyncExternalStore } from "react";

import { appAtomRegistry, subscribeAtomChanges } from "../rpc/atomRegistry";
import {
  environmentThemeDefinitionsAtom,
  publishedThemesAtom,
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
  let previous = appAtomRegistry.get(environmentThemeDefinitionsAtom);
  migrateThemeSelections();
  return subscribeAtomChanges(publishedThemesAtom, (source) => {
    // A live snapshot can equal the boot cache. Its background metadata still permits
    // cleanup that was deferred while the server was connecting.
    const definitions = appAtomRegistry.get(environmentThemeDefinitionsAtom);
    if (source !== null) migrateThemeSelections();
    if (definitions === previous) return;
    previous = definitions;
    storePublishedEnvironmentThemes(definitions);
    refreshTheme({ preservePreview: true });
  });
}

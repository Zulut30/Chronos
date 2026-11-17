// chronos: Chronos starts in the system's language (see locales.ts). See chronos/README.md.
import { SYSTEM_LANGUAGE } from "@t3tools/client-runtime/locales";

import {
  getClientSettings,
  getClientSettingsHydratedSnapshot,
  subscribeClientSettingsHydration,
  updateClientSettings,
} from "../../hooks/useSettings";

const SEEDED_STORAGE_KEY = "chronos:default-language-seeded";
// The settings schema decodes a missing language as "en", so "en" means "never chosen" until
// Chronos has seeded the profile once.
const UPSTREAM_DEFAULT_LANGUAGE = "en";

function readSeeded(): boolean {
  try {
    return window.localStorage.getItem(SEEDED_STORAGE_KEY) !== null;
  } catch {
    return true;
  }
}

function writeSeeded(): void {
  try {
    window.localStorage.setItem(SEEDED_STORAGE_KEY, "1");
  } catch {
    // Without storage the seed simply runs again next launch.
  }
}

/**
 * Once per profile, switches the untouched default ("en") to "system": a Russian system
 * (ru-*) gets Russian, anything else English. A language picked later is kept.
 */
export function seedChronosDefaultLanguage(): void {
  if (typeof window === "undefined" || readSeeded()) return;
  const seed = (): boolean => {
    if (!getClientSettingsHydratedSnapshot()) return false;
    writeSeeded();
    if (getClientSettings().language === UPSTREAM_DEFAULT_LANGUAGE) {
      void updateClientSettings({ language: SYSTEM_LANGUAGE }).catch(() => undefined);
    }
    return true;
  };
  if (seed()) return;
  const unsubscribe = subscribeClientSettingsHydration(() => {
    if (seed()) unsubscribe();
  });
}

// chronos: Chronos ships two interface languages, English and Russian. See chronos/README.md.

export const CHRONOS_LOCALES: ReadonlyArray<string> = ["en", "ru"];

/** Upstream's locale list narrowed to the languages Chronos translates. */
export function chronosSupportedLocales(locales: ReadonlyArray<string>): ReadonlyArray<string> {
  return locales.filter((locale) => CHRONOS_LOCALES.includes(locale));
}

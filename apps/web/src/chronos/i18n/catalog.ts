// chronos: Chronos' Russian catalog for interface strings upstream has not wrapped in gt-react yet.
// Built by chronos/l10n/build-ru-catalog.mjs; loaded with upstream's own `ru` catalog (see
// initializeI18n.ts), active while upstream's i18n runtime shows Russian (<html lang="ru">).
// See chronos/README.md.

export const CHRONOS_CATALOG_LOCALE = "ru";

interface CatalogFile {
  readonly exact: Readonly<Record<string, string>>;
  readonly patterns: ReadonlyArray<readonly [string, string]>;
}

interface LoadedCatalog {
  readonly exact: ReadonlyMap<string, string>;
  readonly patterns: ReadonlyArray<readonly [RegExp, string]>;
}

let catalog: LoadedCatalog | null = null;
let pending: Promise<void> | null = null;

// Patterns run on short strings only; longer text is prose or user content.
const PATTERN_MAX_LENGTH = 200;
const CACHE_LIMIT = 4000;
const cache = new Map<string, string | null>();

function compile(file: CatalogFile): LoadedCatalog {
  const patterns: Array<readonly [RegExp, string]> = [];
  for (const [source, replacement] of file.patterns) {
    try {
      patterns.push([new RegExp(source), replacement]);
    } catch {
      // A bad pattern only loses its own translation.
    }
  }
  return { exact: new Map(Object.entries(file.exact)), patterns };
}

/** Loads the catalog for `locale`, if Chronos has one. Never rejects. */
export function loadChronosCatalog(locale: string): Promise<void> {
  if (locale !== CHRONOS_CATALOG_LOCALE || catalog) return Promise.resolve();
  pending ??= import("./ru.catalog.json")
    .then((module) => {
      catalog = compile(module.default as CatalogFile);
    })
    .catch((error: unknown) => {
      pending = null;
      console.warn("[chronos] Russian catalog failed to load", error);
    });
  return pending;
}

/** True while the app renders in the catalog's language. */
export function isChronosCatalogActive(): boolean {
  return (
    catalog !== null &&
    typeof document !== "undefined" &&
    document.documentElement.lang === CHRONOS_CATALOG_LOCALE
  );
}

function lookup(text: string, depth: number): string | null {
  if (!catalog) return null;
  const exact = catalog.exact.get(text);
  if (exact !== undefined) return exact;
  if (depth > 1 || text.length > PATTERN_MAX_LENGTH) return null;
  for (const [pattern, replacement] of catalog.patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    // Captured parts are often interface words themselves ("Low", "Medium"...).
    return replacement.replace(/\$(\d)/g, (_, index: string) => {
      const part = match[Number(index)] ?? "";
      return lookup(part, depth + 1) ?? part;
    });
  }
  return null;
}

/** Russian for an interface string, keeping its surrounding whitespace; null when unknown. */
export function translateChronosText(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < 2 || !/[A-Za-z]/.test(trimmed)) return null;
  let translated = cache.get(trimmed);
  if (translated === undefined) {
    translated = lookup(trimmed, 0);
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(trimmed, translated);
  }
  if (translated === null) return null;
  return trimmed === text ? translated : text.replace(trimmed, translated);
}

const PRODUCT_NAME = "T3 Code";
const CHRONOS_NAME = "Chronos";
// T3's own services and apps keep their names: the mobile app, T3 Connect, t3.codes.
const KEEP_T3_NAME = /iPhone|Android|mobile|App Store|Google Play|t3\.codes/i;

/** Shows the product as Chronos; text about T3's mobile app and services is left alone. */
export function brandChronosText(text: string): string {
  if (!text.includes(PRODUCT_NAME) || KEEP_T3_NAME.test(text)) return text;
  return text.split(PRODUCT_NAME).join(CHRONOS_NAME);
}

/** Both passes: translation (when active) and the product name. */
export function localizeChronosText(text: string, translate: boolean): string {
  const translated = translate ? (translateChronosText(text) ?? text) : text;
  return brandChronosText(translated);
}

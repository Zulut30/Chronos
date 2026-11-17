import gtConfig from "../../gt.config.json";
import { chronosSupportedLocales } from "../chronos/i18n/locales";

export const DEFAULT_LOCALE = gtConfig.defaultLocale;
// chronos: English and Russian only.
export const SUPPORTED_LOCALES: ReadonlyArray<string> = chronosSupportedLocales([
  DEFAULT_LOCALE,
  ...gtConfig.locales,
]);

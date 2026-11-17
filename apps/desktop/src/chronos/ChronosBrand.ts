// chronos: product name and release links in the desktop shell's own text (dialogs, startup
// recovery page). T3's services and apps keep their names. See chronos/README.md.
import type * as Electron from "electron";

import { CHRONOS_PRODUCT_NAME, CHRONOS_RELEASES_URL } from "@t3tools/shared/cliRelease";

const PRODUCT_NAME = "T3 Code";
const KEEP_T3_NAME = /iPhone|Android|mobile|App Store|Google Play|t3\.codes/i;

export { CHRONOS_RELEASES_URL };

/** Release page of a Chronos version (tags are `chronos-v<version>`). */
export function chronosReleaseTagUrl(version: string): string {
  return `${CHRONOS_RELEASES_URL}/tag/chronos-v${version}`;
}

export function chronosBrand(text: string): string {
  if (!text.includes(PRODUCT_NAME) || KEEP_T3_NAME.test(text)) return text;
  return text.split(PRODUCT_NAME).join(CHRONOS_PRODUCT_NAME);
}

export function chronosBrandMessageBox(
  options: Electron.MessageBoxOptions,
): Electron.MessageBoxOptions {
  return {
    ...options,
    message: chronosBrand(options.message),
    ...(options.title === undefined ? {} : { title: chronosBrand(options.title) }),
    ...(options.detail === undefined ? {} : { detail: chronosBrand(options.detail) }),
  };
}

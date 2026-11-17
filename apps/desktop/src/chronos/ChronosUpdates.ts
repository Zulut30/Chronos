// chronos: Chronos fork glue for desktop updates. See chronos/README.md.
import * as Effect from "effect/Effect";
import * as Electron from "electron";

import { CHRONOS_RELEASES_URL, isChronosVersion } from "@t3tools/shared/cliRelease";

/**
 * Chronos macOS builds are not code-signed, so Squirrel.Mac cannot install an update.
 * Their "download" opens the newest Chronos release page instead.
 */
export function isManualUpdatePlatform(input: {
  readonly platform: NodeJS.Platform;
  readonly appVersion: string;
}): boolean {
  return input.platform === "darwin" && isChronosVersion(input.appVersion);
}

export const openLatestReleasePage: Effect.Effect<boolean> = Effect.promise(() =>
  Electron.shell.openExternal(`${CHRONOS_RELEASES_URL}/latest`).then(
    () => true,
    () => false,
  ),
);

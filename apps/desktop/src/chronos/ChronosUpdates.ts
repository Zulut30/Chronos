// chronos: Chronos fork glue for desktop updates. See chronos/README.md.
import type { DesktopRuntimeArch } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Electron from "electron";

import { CHRONOS_RELEASES_URL, isChronosVersion } from "@t3tools/shared/cliRelease";

/**
 * Chronos macOS builds are ad-hoc signed without an Apple Developer ID, so Squirrel.Mac
 * cannot apply updates in place. Update checks stay enabled; downloading opens the
 * matching DMG installer in the user's browser instead.
 */
export function isManualUpdatePlatform(input: {
  readonly platform: NodeJS.Platform;
  readonly appVersion: string;
}): boolean {
  return input.platform === "darwin" && isChronosVersion(input.appVersion);
}

export function resolveMacosDmgArch(input: {
  readonly hostArch: DesktopRuntimeArch;
  readonly appArch: DesktopRuntimeArch;
}): "arm64" | "x64" {
  // Prefer native Apple Silicon builds, including when an Intel build runs under Rosetta.
  return input.hostArch === "arm64" || input.appArch === "arm64" ? "arm64" : "x64";
}

export function macosDmgDownloadUrl(input: {
  readonly availableVersion: string | null;
  readonly hostArch: DesktopRuntimeArch;
  readonly appArch: DesktopRuntimeArch;
}): string {
  const arch = resolveMacosDmgArch(input);
  const version = input.availableVersion?.trim();
  if (version && isChronosVersion(version)) {
    const encoded = encodeURIComponent(version);
    return `${CHRONOS_RELEASES_URL}/download/chronos-v${encoded}/Chronos-${encoded}-${arch}.dmg`;
  }
  return `${CHRONOS_RELEASES_URL}/latest/download/Chronos-mac-${arch}.dmg`;
}

export function openMacosDmgDownload(input: {
  readonly availableVersion: string | null;
  readonly hostArch: DesktopRuntimeArch;
  readonly appArch: DesktopRuntimeArch;
}): Effect.Effect<boolean> {
  const url = macosDmgDownloadUrl(input);
  const openExternal = Electron.shell?.openExternal;
  if (typeof openExternal !== "function") {
    return Effect.succeed(false);
  }
  return Effect.promise(() =>
    openExternal(url).then(
      () => true,
      () => false,
    ),
  );
}

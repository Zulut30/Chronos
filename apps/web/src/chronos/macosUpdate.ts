import type { DesktopUpdateState } from "@t3tools/contracts";
import { isChronosVersion } from "@t3tools/shared/cliRelease";

import labels from "../../../../chronos/l10n/macos-update.json";
import { getActiveLocale } from "../i18n/messages";

export type MacosUpdateCopy = typeof labels.ru;

export function getMacosUpdateCopy(locale: string = getActiveLocale()): MacosUpdateCopy {
  return locale.startsWith("ru") ? labels.ru : labels.en;
}

export function isMacosManualUpdate(
  state: Pick<DesktopUpdateState, "currentVersion"> | null | undefined,
  platform?: string | null,
): boolean {
  const resolvedPlatform =
    platform !== undefined
      ? platform
      : typeof window !== "undefined"
        ? window.desktopBridge?.getClientPlatform?.()
        : undefined;
  return resolvedPlatform === "darwin" && Boolean(state && isChronosVersion(state.currentVersion));
}

export function getMacosUpdateTooltip(
  state: Pick<DesktopUpdateState, "availableVersion">,
  locale: string = getActiveLocale(),
): string {
  const copy = getMacosUpdateCopy(locale);
  const version = state.availableVersion?.trim();
  return version
    ? copy.tooltipAvailable.replace("{version}", version)
    : copy.tooltipAvailableNoVersion;
}

export function getMacosRosettaWarningDescription(
  action: "download" | "install" | "none",
  locale: string = getActiveLocale(),
): string {
  const copy = getMacosUpdateCopy(locale);
  return action === "download" ? copy.rosettaDownload : copy.rosettaIdle;
}

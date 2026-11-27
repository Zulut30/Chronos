import { describe, expect, it } from "vite-plus/test";

import {
  getMacosRosettaWarningDescription,
  getMacosUpdateCopy,
  getMacosUpdateTooltip,
  isMacosManualUpdate,
} from "./macosUpdate";

describe("macosUpdate", () => {
  it("detects manual DMG update mode only on darwin Chronos builds", () => {
    expect(
      isMacosManualUpdate(
        { currentVersion: "0.1.12-nightly.20261124.5209.chronos.7" },
        "darwin",
      ),
    ).toBe(true);
    expect(
      isMacosManualUpdate(
        { currentVersion: "0.1.12-nightly.20261124.5209.chronos.7" },
        "win32",
      ),
    ).toBe(false);
    expect(
      isMacosManualUpdate({ currentVersion: "0.1.12-nightly.20261124.5209" }, "darwin"),
    ).toBe(false);
    expect(isMacosManualUpdate(null, "darwin")).toBe(false);
  });

  it("formats localized Russian and English DMG update messages", () => {
    expect(
      getMacosUpdateTooltip(
        { availableVersion: "0.1.12-nightly.20261124.5209.chronos.8" },
        "ru",
      ),
    ).toBe("Доступно обновление 0.1.12-nightly.20261124.5209.chronos.8. Нажмите, чтобы скачать DMG.");
    expect(getMacosUpdateTooltip({ availableVersion: null }, "ru")).toBe(
      "Доступно обновление. Нажмите, чтобы скачать DMG.",
    );
    expect(getMacosUpdateCopy("ru").downloadButton).toBe("Скачать DMG");
    expect(getMacosUpdateCopy("en").downloadButton).toBe("Download DMG");
    expect(getMacosRosettaWarningDescription("download", "ru")).toContain("Chronos");
    expect(getMacosRosettaWarningDescription("none", "ru")).not.toContain("T3 Code");
  });
});

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { beforeEach, vi } from "vite-plus/test";

const { openExternalMock } = vi.hoisted(() => ({
  openExternalMock: vi.fn(),
}));

vi.mock("electron", () => ({
  shell: {
    openExternal: openExternalMock,
  },
}));

import * as ChronosUpdates from "./ChronosUpdates.ts";

describe("ChronosUpdates", () => {
  beforeEach(() => {
    openExternalMock.mockReset();
  });

  it("enables manual DMG updates only on macOS Chronos builds", () => {
    assert.isTrue(
      ChronosUpdates.isManualUpdatePlatform({
        platform: "darwin",
        appVersion: "0.1.12-nightly.20261124.5209.chronos.7",
      }),
    );
    assert.isFalse(
      ChronosUpdates.isManualUpdatePlatform({
        platform: "win32",
        appVersion: "0.1.12-nightly.20261124.5209.chronos.7",
      }),
    );
    assert.isFalse(
      ChronosUpdates.isManualUpdatePlatform({
        platform: "darwin",
        appVersion: "0.1.12-nightly.20261124.5209",
      }),
    );
  });

  it("picks the matching DMG URL including Apple Silicon switch from Rosetta", () => {
    assert.equal(
      ChronosUpdates.macosDmgDownloadUrl({
        availableVersion: "0.1.12-nightly.20261124.5209.chronos.8",
        hostArch: "arm64",
        appArch: "arm64",
      }),
      "https://github.com/Zulut30/Chronos/releases/download/chronos-v0.1.12-nightly.20261124.5209.chronos.8/Chronos-0.1.12-nightly.20261124.5209.chronos.8-arm64.dmg",
    );
    assert.equal(
      ChronosUpdates.macosDmgDownloadUrl({
        availableVersion: "0.1.12-nightly.20261124.5209.chronos.8",
        hostArch: "arm64",
        appArch: "x64",
      }),
      "https://github.com/Zulut30/Chronos/releases/download/chronos-v0.1.12-nightly.20261124.5209.chronos.8/Chronos-0.1.12-nightly.20261124.5209.chronos.8-arm64.dmg",
    );
    assert.equal(
      ChronosUpdates.macosDmgDownloadUrl({
        availableVersion: "0.1.12-nightly.20261124.5209.chronos.8",
        hostArch: "x64",
        appArch: "x64",
      }),
      "https://github.com/Zulut30/Chronos/releases/download/chronos-v0.1.12-nightly.20261124.5209.chronos.8/Chronos-0.1.12-nightly.20261124.5209.chronos.8-x64.dmg",
    );
    assert.equal(
      ChronosUpdates.macosDmgDownloadUrl({
        availableVersion: null,
        hostArch: "arm64",
        appArch: "arm64",
      }),
      "https://github.com/Zulut30/Chronos/releases/latest/download/Chronos-mac-arm64.dmg",
    );
  });

  it.effect("opens the matching DMG download URL via Electron shell", () =>
    Effect.gen(function* () {
      openExternalMock.mockResolvedValue(undefined);
      const ok = yield* ChronosUpdates.openMacosDmgDownload({
        availableVersion: "0.1.12-nightly.20261124.5209.chronos.8",
        hostArch: "arm64",
        appArch: "arm64",
      });
      assert.isTrue(ok);
      assert.deepEqual(openExternalMock.mock.calls, [
        [
          "https://github.com/Zulut30/Chronos/releases/download/chronos-v0.1.12-nightly.20261124.5209.chronos.8/Chronos-0.1.12-nightly.20261124.5209.chronos.8-arm64.dmg",
        ],
      ]);

      openExternalMock.mockRejectedValue(new Error("shell unavailable"));
      const failed = yield* ChronosUpdates.openMacosDmgDownload({
        availableVersion: null,
        hostArch: "x64",
        appArch: "x64",
      });
      assert.isFalse(failed);
    }),
  );
});

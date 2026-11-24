import { describe, expect, it } from "vite-plus/test";

import { chronosBrand, chronosBrandMessageBox, chronosReleaseTagUrl } from "./ChronosBrand.ts";

describe("ChronosBrand", () => {
  it("names the product Chronos in dialog text", () => {
    expect(chronosBrand("T3 Code failed to start")).toBe("Chronos failed to start");
    expect(
      chronosBrandMessageBox({ message: "T3 Code 1.0 is available.", detail: "T3 Code restarts." }),
    ).toEqual({ message: "Chronos 1.0 is available.", detail: "Chronos restarts." });
  });

  it("keeps T3's mobile app and services", () => {
    expect(chronosBrand("Get the T3 Code mobile app")).toBe("Get the T3 Code mobile app");
    expect(chronosBrand("Sign in to T3 Connect")).toBe("Sign in to T3 Connect");
  });

  it("links Chronos release tags", () => {
    expect(chronosReleaseTagUrl("0.1.10-nightly.20261116.4774.chronos.4")).toBe(
      "https://github.com/Zulut30/Chronos/releases/tag/chronos-v0.1.10-nightly.20261116.4774.chronos.4",
    );
  });
});

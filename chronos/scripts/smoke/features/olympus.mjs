export async function check({ launchedPid, client, opts, checks, ready, settle, classify, report }) {
  if (opts.verifyOlympus) {
    try {
      const { verifyOlympusScreens } = await import("../olympus-screens.mjs");
      const screens = await verifyOlympusScreens({
        launchedPid, client, opts, checks, ready, settle, classify,
      });
      report.olympus = { ok: true, screenshots: screens.length };
    } catch (error) {
      report.olympus = { ok: false, error: String(error.stack || error) };
      report.ok = false;
      console.error("[FAIL] Olympus:", error);
    }
  }
}

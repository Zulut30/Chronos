// These checks run in the same window. Preserve order across settings reloads and theme changes.
import { check as chatSettings } from "./features/chat-settings.mjs";
import { check as olympus } from "./features/olympus.mjs";
import { check as pcControl } from "./features/pc-control.mjs";

import { check as uiLanguage } from "./features/ui-language.mjs";
import { check as sidebarFooter } from "./features/sidebar-footer.mjs";

// These checks switch languages and reload the shared window. The standard Russian
// screen sweep must run after restoration, and include these results in its totals.
export async function runBeforeScreens(context) {
  if (!context.opts.verifyOlympus || !context.opts.strictEn) return [];
  const results = [];
  for (const [id, check] of [["uiLanguage", uiLanguage], ["sidebarFooter", sidebarFooter]]) {
    let result;
    try {
      result = { ok: true, details: await check(context) };
      console.log("[PASS] " + id);
    } catch (error) {
      result = { ok: false, error: String(error.stack || error) };
      console.error("[FAIL] " + id, error);
    }
    context.report.checks[id] = result;
    results.push(result);
  }
  return results;
}

export async function runFeatureChecks(context) {
  for (const check of [chatSettings, olympus, pcControl]) await check(context);
}

export async function checkArtifactsAfterReport(client, opts, report, launchedChild) {
  if (report.ok && process.env.CHRONOS_VERIFY_ARTIFACTS === "1") {
    const { verifyArtifacts } = await import("./artifacts.mjs");
    await verifyArtifacts(client, opts, launchedChild.pid);
  }
}

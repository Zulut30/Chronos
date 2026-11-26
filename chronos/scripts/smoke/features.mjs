// These checks run in the same window. Preserve order across settings reloads and theme changes.
import { check as chatSettings } from "./features/chat-settings.mjs";
import { check as olympus } from "./features/olympus.mjs";
import { check as pcControl } from "./features/pc-control.mjs";

export async function runFeatureChecks(context) {
  for (const check of [chatSettings, olympus, pcControl]) await check(context);
}

export async function checkArtifactsAfterReport(client, opts, report, launchedChild) {
  if (report.ok && process.env.CHRONOS_VERIFY_ARTIFACTS === "1") {
    const { verifyArtifacts } = await import("./artifacts.mjs");
    await verifyArtifacts(client, opts, launchedChild.pid);
  }
}

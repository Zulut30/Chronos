import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export async function runFullSmoke(port, output, env) {
  assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
  // Diagnostic on a private runner, before smoke starts collecting console errors.
  const prompts = await fetch("http://127.0.0.1:4517/api/prompts");
  if (!prompts.ok) console.error("Isolated skills service", prompts.status, await prompts.text());
  const result = spawnSync(process.execPath, [join(import.meta.dirname, "../smoke/smoke.mjs"),
    "--port", String(port), "--profile", "full", "--out", resolve(output)],
    { env, stdio: "inherit", windowsHide: true, timeout: 360000 });
  if (result.error) throw result.error;
  const { summary } = JSON.parse(readFileSync(resolve(output, "report.json"), "utf8"));
  assert.equal(result.status, 0);
  assert.equal(summary.totalChecks, 14);
  assert.equal(summary.passedChecks, 14);
  assert.equal(summary.totalErrors, 0);
}

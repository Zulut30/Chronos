// The packaged desktop supervises fixed Olympus ports. Run in a disposable Windows VM.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createSandbox } from "./sandbox.mjs";

assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted", "Use a disposable hosted runner for fixed sidecar ports");
const [distribution, output] = process.argv.slice(2);
const sandbox = createSandbox(2, 50);
try {
  const debug = await sandbox.port();
  const exe = resolve(distribution, "Chronos.exe");
  const result = spawnSync(process.execPath, [
    join(import.meta.dirname, "../smoke/smoke.mjs"), "--launch", exe, "--port", String(debug),
    "--extra-arg", "--user-data-dir=" + sandbox.profile, "--profile", "full", "--out", resolve(output),
  ], { env: sandbox.env, stdio: "inherit", windowsHide: true, timeout: 360000 });
  if (result.error) throw result.error;
  const reportPath = resolve(output, "report.json");
  assert(existsSync(reportPath), "Missing smoke report");
  const { summary } = JSON.parse(readFileSync(reportPath, "utf8"));
  assert.equal(result.status, 0);
  assert.equal(summary.totalChecks, 14);
  assert.equal(summary.passedChecks, 14);
  assert.equal(summary.totalErrors, 0);
} finally {
  sandbox.close();
}

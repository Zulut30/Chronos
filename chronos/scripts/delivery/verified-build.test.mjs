import assert from "node:assert/strict";
import { test } from "node:test";
import { checkDesktop, verifiedBuild } from "./verified-build.mjs";
import { verifyStrictReport } from "../smoke/strict-report.mjs";

test("only the same full desktop with passing checks, strict smoke and previous-main pair is reusable", async () => {
  const base = "a".repeat(40), head = "b".repeat(40);
  const success = { head_sha: head, event: "workflow_dispatch", conclusion: "success", status: "completed" };
  const build = { ...success, path: ".github/workflows/chronos-desktop.yml", display_title: "Desktop" };
  const smoke = { ...success, id: 12, display_title: "Strict desktop 11" };
  const perf = { ...success, id: 13, path: ".github/workflows/chronos-perf.yml" };
  const receipt = { expired: false, workflow_run: { id: 13, head_sha: head } };
  const assets = ["win-x64","mac-arm64","mac-x64","cli-linux-x64","cli-linux-arm64","cli-darwin-arm64"]
    .map(key => ({ name: "chronos-" + key }));
  const api = async url => {
    if (url.includes("chronos-smoke.yml/")) return { workflow_runs: [smoke] };
    if (url.includes("chronos-checks.yml/")) return { workflow_runs: [{ ...success, id: 14 }] };
    if (url.startsWith("actions/artifacts?")) return { artifacts: url.includes(`perf-pass-${base}-${head}-11&`) ? [receipt] : [] };
    if (url.includes("/jobs?")) return { jobs: ["Typecheck and tests","Server integration regressions"].map(name => ({ name, conclusion: "success" })) };
    if (url.includes("/artifacts?")) return { artifacts: assets };
    return url.endsWith("/11") ? build : perf;
  };
  assert.equal((await verifiedBuild(base, head, api)).build, "11");
  assert.equal(await verifiedBuild("c".repeat(40), head, api), null);
  receipt.expired = true; assert.equal(await verifiedBuild(base, head, api), null); receipt.expired = false;
  smoke.display_title = "Diagnostic desktop 11"; assert.equal(await verifiedBuild(base, head, api), null);
  smoke.display_title = "Strict desktop 11"; assets.pop(); assert.equal(await verifiedBuild(base, head, api), null);
  assert.throws(() => checkDesktop({ ...build, display_title: "Perf Windows " + head }, head));
  assert.throws(() => checkDesktop(build, base));
});
test("strict smoke rejects incomplete green summaries", () => {
  const summary = { passedChecks: 18, totalChecks: 18, skippedChecks: 0, totalErrors: 0, unexpectedEnglishPhrases: [] };
  const checks = { uiLanguage: { ok: true }, sidebarFooter: { ok: true } };
  verifyStrictReport({ ok: true, summary, checks });
  assert.throws(() => verifyStrictReport({ ok: true, summary }));
  assert.throws(() => verifyStrictReport({ ok: true, summary: { ...summary, totalChecks: 16, passedChecks: 16 }, checks }));
});

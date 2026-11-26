import assert from "node:assert/strict";
import { appendFileSync, readFileSync } from "node:fs";

const desktop = "chronos-desktop.yml";
const shaPattern = /^[0-9a-f]{40}$/;
const isFullDesktop = run => run.path === ".github/workflows/" + desktop &&
  run.event === "workflow_dispatch" && !run.display_title.startsWith("Perf Windows ");
export function checkDesktop(run, sha) {
  assert.ok(shaPattern.test(sha) && run.head_sha === sha && isFullDesktop(run), "Expected a manual full desktop run on " + sha);
  assert.ok(run.status !== "completed" || run.conclusion === "success", "Desktop build failed");
}
const requiredAssets = ["chronos-win-x64", "chronos-mac-arm64", "chronos-mac-x64",
  "chronos-cli-linux-x64", "chronos-cli-linux-arm64", "chronos-cli-darwin-arm64"];

async function get(endpoint) {
  const response = await fetch(process.env.GITHUB_API_URL + "/repos/" + process.env.GITHUB_REPOSITORY + "/" + endpoint, {
    headers: { Authorization: "Bearer " + process.env.GH_TOKEN, Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw Error(`GitHub HTTP ${response.status} for ${endpoint}`);
  return response.json();
}

export async function verifiedBuild(base, head, api = get) {
  assert.ok(shaPattern.test(base) && shaPattern.test(head) && base !== head, "Expected distinct immutable SHAs");
  const runs = async workflow => (await api(`actions/workflows/${workflow}/runs?head_sha=${head}&status=success&per_page=100`)).workflow_runs
    .filter(r => r.head_sha === head && r.conclusion === "success" && ["workflow_dispatch", "push"].includes(r.event));
  const smokes = await runs("chronos-smoke.yml");
  for (const smoke of smokes) {
    const id = /^Strict desktop (\d+)$/.exec(smoke.display_title)?.[1];
    if (!id || smoke.event !== "workflow_dispatch") continue;
    const receipts = await api(`actions/artifacts?name=perf-pass-${base}-${head}-${id}&per_page=100`);
    for (const a of receipts.artifacts.filter(a => !a.expired && a.workflow_run.head_sha === head)) {
      const perf = await api("actions/runs/" + a.workflow_run.id);
      if (perf.path !== ".github/workflows/chronos-perf.yml" || perf.head_sha !== head || perf.conclusion !== "success" ||
          !["push","workflow_dispatch"].includes(perf.event)) continue;
      const build = await api("actions/runs/" + id);
      if (!isFullDesktop(build) || build.head_sha !== head || build.conclusion !== "success") continue;
      const assets = (await api(`actions/runs/${id}/artifacts?per_page=100`)).artifacts.filter(a => !a.expired);
      if (!requiredAssets.every(name => assets.some(a => a.name === name))) continue;
      for (const checks of await runs("chronos-checks.yml")) {
        const jobs = (await api(`actions/runs/${checks.id}/jobs?per_page=100`)).jobs;
        if (["Typecheck and tests", "Server integration regressions"].every(name => jobs.some(j => j.name === name && j.conclusion === "success")))
          return { base, head, build: id, smoke: smoke.id, perf: perf.id, checks: checks.id };
      }
    }
  }
  return null;
}

if (import.meta.main && process.argv[2] === "smoke") {
  assert.match(process.env.DESKTOP_RUN_ID, /^\d+$/);
  checkDesktop(await get("actions/runs/" + process.env.DESKTOP_RUN_ID), process.env.GITHUB_SHA);
} else if (import.meta.main) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH));
  const head = process.env.GITHUB_SHA;
  const publishing = process.argv[2] === "release";
  let base = event.before;
  if (publishing) {
    assert.equal((await get("commits/main")).sha, head, "Tag must identify current main");
    const history = await get("activity?ref=refs%2Fheads%2Fmain&per_page=100");
    base = history.find(change => change.after === head && change.activity_type === "push")?.before;
  }
  const result = await verifiedBuild(base, head);
  if (publishing) assert.ok(result, "Missing exact previous-main/candidate gate, full desktop, strict smoke or checks");
  for (const [key, value] of Object.entries({ reuse: Boolean(result), ...result }))
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  console.log(result ?? "No matching gates; run normal CI");
}

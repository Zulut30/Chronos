// Resolve both package identities before any timing. Only this metadata job can request builds.
import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const env = process.env;
const endpoint = env.GITHUB_API_URL + "/repos/" + env.GITHUB_REPOSITORY;
async function api(path, body) {
  const response = await fetch(endpoint + path, {
    method: body ? "POST" : "GET",
    headers: { Authorization: "Bearer " + env.GH_TOKEN, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw Error(path + " HTTP " + response.status + " " + (await response.text()).slice(0, 300));
  return response.status === 204 ? null : response.json();
}
const workflow = "/actions/workflows/chronos-desktop.yml";
async function packageFor(target) {
  const { sha } = target;
  const pinnedTitle = "Perf Windows " + sha;
  const deadline = Date.now() + 1000 * 60 * 85;
  let requestedAt = 0;
  async function available(runs, pinned) {
    for (const run of runs) {
      const { artifacts } = await api("/actions/runs/" + run.id + "/artifacts?per_page=100");
      if (artifacts.some(a => a.name === "chronos-win-x64" && !a.expired)) {
        return { ...target, run: run.id, pinned };
      }
    }
  }
  do {
    const [normalList, pinnedList] = await Promise.all([
      api(workflow + "/runs?head_sha=" + sha + "&per_page=100"),
      api(workflow + "/runs?event=workflow_dispatch&branch=" + encodeURIComponent(env.GITHUB_REF_NAME) + "&per_page=100"),
    ]);
    const normal = normalList.workflow_runs.filter(r => r.head_sha === sha && !r.display_title.startsWith("Perf Windows "));
    const pinned = pinnedList.workflow_runs.filter(r => r.display_title === pinnedTitle);
    const packaged = await available(normal, false) ?? await available(pinned, true);
    if (packaged) return packaged;
    const inFlight = list => list.some(r => r.status !== "completed");
    if (!inFlight(normal) && !inFlight(pinned)) {
      if (!requestedAt) {
        requestedAt = Date.now();
        console.log("Requesting Windows-only build of immutable commit", sha);
        await api(workflow + "/dispatches", { ref: env.GITHUB_REF_NAME, inputs: { perf_sha: sha } });
      } else if (Date.now() - requestedAt > 120000) {
        throw Error("Pinned Windows build failed for " + sha + " (run " + pinned[0]?.id + ")");
      }
    }
    await sleep(30000);
  } while (Date.now() < deadline);
  throw Error("Timed out waiting for Windows package: " + target.ref + " " + sha);
}
if (env.PAIR) {
  const pair = JSON.parse(env.PAIR);
  pair.base = await packageFor(pair.base);
  pair.head = pair.head.sha === pair.base.sha ? { ...pair.base, ref: pair.head.ref } : await packageFor(pair.head);
  appendFileSync(env.GITHUB_OUTPUT, "pair=" + JSON.stringify(pair) + "\n");
} else {
  const audit = env.AUDIT === "true" || (env.GITHUB_REF_NAME === "perf/guard" && env.COMMIT_MESSAGE?.includes("[perf-audit]"));
  // Historical audit tips, reachable from main after their branches were retired.
  const auditTips = {
    "feature/artifacts": "74dc71fdcfbda5a8e7925346c3159f21cfa0ba45",
    "feature/pc-control": "7c3fe21852f87b117c5c0c5bef840520d20e92b0",
    "perf/round-3": "1ea16cbfa900dac9e42528e5ad9a8174e3b0a985",
    "fix/stability-2026-11-25": "4fa969e79ace1dbc133256661380202118dff8c7"
  };
  const refs = audit ? ["main", ...Object.keys(auditTips)] : [env.TARGET || env.GITHUB_REF_NAME];
  const targets = new Map();
  for (const ref of new Set(["main", ...refs])) {
    assert.match(ref, /^[\w./-]+$/);
    const pinned = audit ? auditTips[ref] : !env.TARGET && ref === env.GITHUB_REF_NAME ? env.GITHUB_SHA : undefined;
    const sha = pinned ?? (await api("/commits/" + encodeURIComponent(ref))).sha;
    targets.set(ref, { ref, sha });
  }
  const base = targets.get("main");
  appendFileSync(env.GITHUB_OUTPUT, "matrix=" + JSON.stringify({ include: refs.map(ref => ({ name: ref.replaceAll("/", "-"), base, head: targets.get(ref) })) }) + "\n");
}

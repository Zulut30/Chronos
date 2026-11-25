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
const audit = env.AUDIT === "true" || (env.GITHUB_REF_NAME === "perf/guard" && env.COMMIT_MESSAGE?.includes("[perf-audit]"));
const refs = audit ? ["main", "feature/artifacts", "feature/pc-control", "perf/round-3", "fix/stability-2026-11-25"] : [env.TARGET || env.GITHUB_REF_NAME];
const targets = new Map();
for (const ref of new Set(["main", ...refs])) {
  assert.match(ref, /^[\w./-]+$/);
  const sha = !audit && !env.TARGET && ref === env.GITHUB_REF_NAME ? env.GITHUB_SHA : (await api("/commits/" + encodeURIComponent(ref))).sha;
  targets.set(ref, { ref, sha });
}
async function packageFor({ref, sha}) {
  const runs = async () => (await api(workflow + "/runs?head_sha=" + sha + "&per_page=100")).workflow_runs;
  let requested = false;
  const deadline = Date.now() + 1000 * 60 * 100;
  do {
    const list = await runs();
    for (const run of list) {
      const { artifacts } = await api("/actions/runs/" + run.id + "/artifacts?per_page=100");
      if (artifacts.some(a => a.name === "chronos-win-x64" && !a.expired)) return run.id;
    }
    if (!list.some(r => r.status !== "completed")) {
      if (requested) throw Error("No Windows package for " + ref + " " + sha);
      assert.equal((await api("/commits/" + encodeURIComponent(ref))).sha, sha, "Branch moved before build dispatch");
      await api(workflow + "/dispatches", { ref });
      requested = true;
    }
    await sleep(30000);
  } while (Date.now() < deadline);
  throw Error("Timed out waiting for exact Windows package: " + ref + " " + sha);
}
await Promise.all([...targets.values()].map(async t => { t.run = await packageFor(t); console.log(t); }));
const base = targets.get("main");
appendFileSync(env.GITHUB_OUTPUT, "matrix=" + JSON.stringify({ include: refs.map(ref => ({ name: ref.replaceAll("/", "-"), base, head: targets.get(ref) })) }) + "\n");

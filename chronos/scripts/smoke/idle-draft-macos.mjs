import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { prepareIdleDraft, readIdleDraft, verifyResume } from "./idle-draft.mjs";

function sample(rootPid) {
  const rows = new Map();
  const table = execFileSync("ps", ["-Aww", "-o", "pid=,ppid=,time=,command="], { encoding: "utf8" });
  for (const line of table.trimEnd().split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)\s+(.*)$/.exec(line);
    assert.ok(match, "Unexpected BSD ps CPU time");
    const [, pid, parent, hours, minutes, seconds, command] = match;
    rows.set(+pid, { parent: +parent, cpu: +(hours ?? 0) * 3600 + +minutes * 60 + +seconds,
      gpu: command.includes("--type=gpu-process") });
  }
  assert.ok(rows.has(rootPid), "Launched Chronos process exited");
  const tree = new Map();
  for (const [pid, row] of rows) {
    let ancestor = pid;
    while (ancestor && ancestor !== rootPid) ancestor = rows.get(ancestor)?.parent;
    if (ancestor === rootPid) tree.set(pid, row);
  }
  assert.ok([...tree.values()].some(row => row.gpu), "GPU process missing from launched tree");
  return tree;
}

export async function measureMacDraft(client, pid) {
  const probe = (action, arg) => client.probe(action, arg);
  const send = (method, params) => client.send(method, params);
  const timeOrigin = async () => (await send("Runtime.evaluate", {
    expression: "performance.timeOrigin", returnByValue: true,
  })).result.value;
  const previous = await timeOrigin();
  await send("Page.reload");
  const deadline = Date.now() + 15000;
  while (await timeOrigin() === previous) {
    assert.ok(Date.now() < deadline, "Could not clear screenshot animation overrides");
    await sleep(100);
  }
  await prepareIdleDraft(probe, send);
  await sleep(16000);
  const motionStart = await readIdleDraft(probe, true);
  const before = sample(pid);
  const start = performance.now();
  await sleep(30000);
  const after = sample(pid);
  const seconds = (performance.now() - start) / 1000;
  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), "Process tree changed while sampling");
  await verifyResume(probe, send, motionStart, await readIdleDraft(probe, true));
  let total = 0, gpu = 0;
  for (const [id, row] of after) {
    const cpu = (row.cpu - before.get(id).cpu) * 100 / seconds;
    total += cpu;
    if (row.gpu) gpu += cpu;
  }
  return { seconds, totalCpuPct: total, gpuCpuPct: gpu };
}

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export async function measureAcp({ launch, rpc, sb, threadId, expectUnload }) {
  const get = id => rpc.call("orchestration.getThreadProjection", { threadId: id });
  const cmd = (type, id, fields = {}) => rpc.call("orchestration.dispatchCommand", {
    type, commandId: crypto.randomUUID(), threadId: id, ...fields,
  });
  const waitAnswer = (text, count) => sb.wait("ACP completed with " + text, async () => {
    const p = await get(threadId);
    if (p.runs.at(-1)?.status === "failed") throw Error(JSON.stringify([p.providerSessions.at(-1)?.lastError, p.turnItems.at(-1)?.failure]));
    return p.runs.length === count && p.runs.at(-1).status === "completed" &&
      p.turnItems.some(i => i.type === "assistant_message" && i.text?.trim() === text) && p;
  });
  const marker = crypto.randomUUID();
  await launch(threadId, "SEED_" + marker + " bench-" + threadId);
  const first = await waitAnswer("Fixture answer", 1);
  const nativeId = first.providerThreads.at(-1)?.nativeThreadRef?.nativeId;
  assert.match(nativeId, /^[a-f0-9-]{36}$/);
  const currentOwner = () => JSON.parse(readFileSync(join(sb.root, nativeId + ".pids"), "utf8").trim().split("\n").at(-1));
  const owner = currentOwner();
  const memory = (ids, born) => JSON.parse(execFileSync("pwsh", ["-NoProfile", "-File",
    join(import.meta.dirname, "acp-processes.ps1"), String(ids.agent), String(ids.bridge),
    ...(born ? [born.agent.born, born.bridge.born] : []),
  ], { encoding: "utf8", timeout: 15000 }));
  const before = memory(owner);
  assert.equal(before.count, 2);
  const blocked = crypto.randomUUID();
  await launch(blocked, "APPROVAL_FIXTURE bench-" + blocked);
  await sb.wait("pending approval", async () => (await get(blocked)).runtimeRequests.some(r => r.status === "pending"));
  await sleep(100000);
  const after = memory(owner, before);
  assert.equal(after.count, expectUnload ? 0 : 2, "agent + bridge after idle");
  const pending = (await get(blocked)).runtimeRequests.find(r => r.status === "pending");
  assert(pending);
  await cmd("runtime-request.respond", blocked, { requestId: pending.id, decision: "accept" });
  await sb.wait("permission answer still reaches the same transport", async () =>
    (await get(blocked)).turnItems.some(i => i.type === "assistant_message" && i.text?.includes("Bench permission granted.")));

  const respond = (text, count) => cmd("message.dispatch", threadId, {
    messageId: crypto.randomUUID(), createdBy: "user", creationSource: "web",
    dispatchMode: { type: "start_immediately" }, attachments: [], text: text + " bench-" + threadId,
  }).then(() => waitAnswer(marker, count));
  const resumed = await respond("RECALL_FIXTURE", 2);
  assert.equal(resumed.providerThreads.at(-1)?.nativeThreadRef?.nativeId, nativeId);
  const reopened = currentOwner();
  assert.equal(reopened.method, expectUnload ? "restore" : "new");
  const checkClose = async (type, ids) => {
    const sample = memory(ids);
    assert.equal(sample.count, 2);
    await cmd(type, threadId);
    const deadline = Date.now() + 20000;
    let remaining;
    do {
      remaining = memory(ids, sample);
      if (remaining.count === 0) break;
      await sleep(500);
    } while (Date.now() < deadline);
    if (expectUnload) assert.equal(remaining.count, 0, type + " exits both original processes");
    return remaining;
  };
  const archive = await checkClose("thread.archive", reopened);
  await cmd("thread.unarchive", threadId);
  const unarchived = await respond("RECALL_FIXTURE", 3);
  assert.equal(unarchived.providerThreads.at(-1)?.nativeThreadRef?.nativeId, nativeId);
  const settled = await checkClose("thread.settle", currentOwner());
  return { before, after, archive, settled, nativeHistoryVerified: true };
}

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export async function claudeMock(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks));
  const last = JSON.stringify(body.messages.at(-1));
  if (last.includes("HOLD_FIXTURE")) return;
  const previous = JSON.stringify(body.messages.slice(0, -1));
  const marker = previous.match(/SEED_([a-f0-9-]{36})/);
  const text = last.includes("RECALL_FIXTURE") ? (marker?.[1] ?? "missing history") : "Fixture answer";
  const message = {
    id: "msg_" + crypto.randomUUID(), type: "message", role: "assistant",
    model: body.model, content: [], stop_reason: null, stop_sequence: null,
    usage: { input_tokens: 20, output_tokens: 1 },
  };
  if (!body.stream) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ...message, content: [{ type: "text", text }], stop_reason: "end_turn" }));
    return;
  }
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const [type, payload] of [
    ["message_start", { message }],
    ["content_block_start", { index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { index: 0, delta: { type: "text_delta", text } }],
    ["content_block_stop", { index: 0 }],
    ["message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } }],
    ["message_stop", {}],
  ]) res.write("event: " + type + "\ndata: " + JSON.stringify({ type, ...payload }) + "\n\n");
  res.end();
}

export async function measureClaude({ launch, rpc, sb, app, binary, threadId, idleExperiment, expectUnload }) {
  const get = id => rpc.call("orchestration.getThreadProjection", { threadId: id });
  const waitAnswer = (id, text) => sb.wait("assistant response", async () => {
    const p = await get(id);
    if (p.runs.at(-1)?.status === "failed") throw Error(JSON.stringify({ run: p.runs.at(-1), session: p.providerSessions.at(-1)?.lastError, items: p.turnItems.slice(-3) }).slice(-2500));
    return p.turnItems.some(item => item.type === "assistant_message" && item.text?.trim() === text);
  });
  const list = () => JSON.parse(execFileSync("pwsh", [
    "-NoProfile", "-File", join(import.meta.dirname, "guard-process.ps1"), "-RootPid",
    String(app.pid), "-AgentExe", binary, "-ListAgents",
  ], { encoding: "utf8", timeout: 20000 }));
  const marker = crypto.randomUUID();
  const start = performance.now();
  await launch(threadId, "SEED_" + marker);
  await waitAnswer(threadId, "Fixture answer");
  const firstResponseMs = performance.now() - start;
  await sb.wait("first turn completed", async () => (await get(threadId)).runs.at(-1)?.status === "completed");
  if (!idleExperiment) return { firstResponseMs };

  const hidden = list();
  assert.equal(hidden.length, 1);
  const nativeId = (await get(threadId)).providerThreads.at(-1)?.nativeThreadRef?.nativeId;
  assert(nativeId, "Missing persisted native session ID");
  const visible = crypto.randomUUID(), active = crypto.randomUUID();
  await launch(visible, "VISIBLE_FIXTURE");
  let viewing = false;
  rpc.stream("orchestration.subscribeThread", { threadId: visible, acceptBoundedSnapshot: true }, () => { viewing = true; });
  await sb.wait("view subscription", () => viewing);
  await waitAnswer(visible, "Fixture answer");
  await launch(active, "HOLD_FIXTURE");
  const before = await sb.wait("three live CLIs", () => {
    const ids = list();
    return ids.length === 3 && ids;
  });
  await sleep(100000); // One minute idle plus up to one 30-second sweep and teardown.
  rpc.check();
  const after = list();
  assert.deepEqual(after.toSorted(), before.filter(id => !expectUnload || id !== hidden[0]).toSorted());
  const projection = await get(threadId);
  assert.equal(projection.providerSessions.at(-1)?.status === "stopped", expectUnload);
  assert.equal((await get(active)).runs.at(-1)?.status, "running");
  const resumedAt = performance.now();
  await rpc.call("orchestration.dispatchCommand", {
    type: "message.dispatch", createdBy: "user", creationSource: "web",
    commandId: crypto.randomUUID(), messageId: crypto.randomUUID(), threadId,
    text: "RECALL_FIXTURE", attachments: [], dispatchMode: { type: "start_immediately" },
  });
  await waitAnswer(threadId, marker);
  const nextResponseMs = performance.now() - resumedAt;
  assert.equal((await get(threadId)).providerThreads.at(-1)?.nativeThreadRef?.nativeId, nativeId);
  const resumed = list();
  assert.equal(resumed.length, 3);
  assert.equal(resumed.includes(hidden[0]), !expectUnload);
  return { firstResponseMs, before: before.length, after: after.length, resumed: resumed.length, nextResponseMs, nativeHistoryVerified: true };
}

// Run the vendor's diagnostic after timing in the disposable, credential-free home.
// Retain only numeric memory counters. The heap snapshot stays in the VM sandbox.
export async function heapDiagnostics(rpc, threadId, home) {
  const desktop = join(home, "Desktop");
  mkdirSync(desktop, { recursive: true });
  await rpc.call("orchestration.dispatchCommand", {
    type: "message.dispatch", createdBy: "user", creationSource: "web",
    commandId: crypto.randomUUID(), messageId: crypto.randomUUID(), threadId,
    text: "/heapdump", attachments: [], dispatchMode: { type: "start_immediately" },
  });
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    for (const dir of [desktop, home]) {
      const name = readdirSync(dir).find(n => n.endsWith("-diagnostics.json"));
      if (!name || !existsSync(join(dir, name))) continue;
      let data;
      try { data = JSON.parse(readFileSync(join(dir, name), "utf8")); } catch { continue; }
      const counters = {};
      function walk(value, path) {
        if (typeof value === "number" && /heap|rss|external|buffer|resident|allocated|footprint/i.test(path)) counters[path] = value;
        else if (value && typeof value === "object" && !Array.isArray(value)) {
          for (const [key, child] of Object.entries(value)) {
            if (/^[a-z][a-z0-9_]*$/i.test(key)) walk(child, path ? path + "." + key : key);
          }
        }
      }
      walk(data, "");
      return { available: true, counters };
    }
    await sleep(250);
  }
  return { available: false };
}

// Minimal local ACP workload following the handshake in apps/server/scripts/dev-replay-agent.ts.
import { readFileSync, appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { createInterface } from "node:readline";
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const [root, frames, interval, workload] = process.argv.slice(2);
let sessionId = crypto.randomUUID();
const lifecycle = workload === "acp-lifecycle";
let bridge;
async function connectBridge(params) {
  assert.equal(process.env.CHRONOS_BENCH_LIFECYCLE, "1");
  const mcp = params.mcpServers.find(server => server.name === "t3-code");
  assert.equal(mcp?.command.toLowerCase(), process.env.CHRONOS_BENCH_EXE.toLowerCase());
  assert.equal(mcp.args.length, 2);
  assert.equal(resolve(mcp.args[0]).toLowerCase(), resolve(process.env.CHRONOS_BENCH_ENTRY).toLowerCase());
  assert.equal(mcp.args[1], "acp-mcp-bridge");
  if (bridge) return;
  bridge = spawn(mcp.command, mcp.args, {
    env: { ...process.env, ...Object.fromEntries(mcp.env.map(v => [v.name, v.value])) },
    stdio: ["pipe", "pipe", "inherit"], windowsHide: true,
  });
  const ready = new Promise((resolve, reject) => {
    bridge.once("error", reject);
    bridge.once("exit", () => reject(Error("Bridge exited during handshake")));
    createInterface({ input: bridge.stdout }).on("line", line => {
      const reply = JSON.parse(line);
      if (reply.id === 1 && reply.result?.protocolVersion) resolve();
    });
  });
  bridge.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
    protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "bench", version: "1" },
  } }) + "\n");
  await Promise.race([ready, sleep(15000, null, { ref: false }).then(() => { throw Error("Bridge failed to initialize"); })]);
  appendFileSync(join(root, sessionId + ".pids"), JSON.stringify({ agent: process.pid, bridge: bridge.pid, method: params.sessionId ? "restore" : "new" }) + "\n");
}
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
let pendingPermission;
for await (const line of createInterface({ input: process.stdin })) {
  const { id, method, params, result: reply } = JSON.parse(line);
  if (id === "bench-permission" && pendingPermission !== undefined) {
    if (reply?.outcome?.optionId !== "allow") throw Error("Unexpected mock decision");
    send({
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Bench permission granted." },
        },
      },
    });
    send({ id: pendingPermission, result: { stopReason: "end_turn" } });
    pendingPermission = undefined;
    continue;
  }
  if (id == null) continue;
  if (lifecycle && method) appendFileSync(join(root, "acp-fixture.log"), method + "\n");
  let result = {};
  if (method === "initialize") {
    result = {
      protocolVersion: 1,
      agentCapabilities: lifecycle ? { loadSession: true, sessionCapabilities: { resume: {} } } : {},
      authMethods: [],
      agentInfo: { name: "chronos-bench", version: "1" },
    };
  } else if (lifecycle && (method === "session/load" || method === "session/resume")) {
    sessionId = params.sessionId;
    assert.match(sessionId, /^[a-f0-9-]{36}$/);
    assert(existsSync(join(root, sessionId + ".history")));
    await connectBridge(params);
    result = { models: { currentModelId: "bench", availableModels: [{ modelId: "bench", name: "Bench" }] } };
  } else if (method === "session/new") {
    if (lifecycle) await connectBridge(params);
    result = {
      sessionId,
      models: { currentModelId: "bench", availableModels: [{ modelId: "bench", name: "Bench" }] },
    };
  } else if (lifecycle && method === "session/set_config_option") {
    result = { configOptions: [] };
  } else if (method === "session/prompt") {
    const thread = JSON.stringify(params.prompt).match(/bench-([a-f0-9-]{36})/)?.[1];
    if (!thread) throw Error("Missing workload ID");
    const prompt = JSON.stringify(params.prompt);
    if (prompt.includes("APPROVAL_FIXTURE")) {
      pendingPermission = id;
      send({
        id: "bench-permission",
        method: "session/request_permission",
        params: {
          sessionId,
          toolCall: {
            toolCallId: "bench-permission",
            title: "Bench permission",
            kind: "execute",
            status: "pending",
          },
          options: [
            { optionId: "allow", name: "Allow", kind: "allow_once" },
            { optionId: "no", name: "Decline", kind: "reject_once" },
          ],
        },
      });
      continue;
    }
    if (lifecycle) {
      const path = join(root, sessionId + ".history");
      const seed = prompt.match(/SEED_([a-f0-9-]{36})/)?.[1];
      if (seed) writeFileSync(path, seed);
      const text = prompt.includes("RECALL_FIXTURE") ? readFileSync(path, "utf8") : "Fixture answer";
      send({ method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } } });
      send({ id, result: { stopReason: "end_turn" } });
      continue;
    }
    const record = prompt.match(/HISTORY_(\d+)/)?.[1];
    if (record) {
      send({
        method: "session/update",
        params: {
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "History response " + record + "." },
          },
        },
      });
      send({ id, result: { stopReason: "end_turn" } });
      continue;
    }
    writeFileSync(join(root, thread + ".ready"), String(process.pid));
    const seed = JSON.stringify(params.prompt).includes("SEED_HISTORY");
    const deadline = Date.now() + 150000;
    while (!seed && !existsSync(join(root, "go"))) {
      if (Date.now() > deadline) throw Error("Start barrier expired");
      await sleep(50);
    }
    let final = "";
    for (let i = 0; i < (seed ? 12 : Number(frames)); i++) {
      const marker = `MARK_${thread}_${i}_${Date.now()} ${"x".repeat(56)}\n\n`;
      const lines = seed ? 48 : i === 0 ? 96 : 2;
      const code = () =>
        Array.from({ length: lines }, (_, j) => `const value_${i}_${j} = processValue(${i}, ${j});`).join(
          "\n",
        );
      const text =
        workload !== "code"
          ? marker
          : seed
            ? marker + "```js\n" + code() + "\n```\n\n"
            : (i % 6 === 0 ? "```js\n" : "") +
              "// " +
              marker.trim() +
              "\n" +
              code() +
              "\n" +
              (i % 6 === 5 || i === Number(frames) - 1 ? "```\n" : "");
      final += text;
      send({
        method: "session/update",
        params: {
          sessionId,
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
        },
      });
      if (!seed) await sleep(Number(interval));
    }
    writeFileSync(join(root, thread + ".txt"), final);
    if (workload === "code") {
      send({
        method: "session/update",
        params: {
          sessionId,
          update: {
            sessionUpdate: "usage_update",
            used: 2500,
            size: 10000,
            cost: { amount: 0.42, currency: "USD" },
          },
        },
      });
    }
    const outputTokens = Number(prompt.match(/SPEED_TOKENS_(\d+)/)?.[1] ?? 500);
    result = {
      stopReason: "end_turn",
      ...(workload === "code"
        ? {
            usage: { totalTokens: 2500 + outputTokens, inputTokens: 2500, outputTokens },
          }
        : {}),
    };
  }
  send({ id, result });
}

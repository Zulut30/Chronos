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
const bridgeBench = workload === "acp-bridge";
const background = workload === "antigravity-background";
let wakeTimer;
function cancelWake() {
  clearInterval(wakeTimer);
  wakeTimer = undefined;
}
function startWake() {
  let started = false;
  const update = update => send({ method: "session/update", params: { sessionId, update } });
  wakeTimer = setInterval(() => {
    if (!started && existsSync(join(root, "wake"))) {
      started = true;
      update({ sessionUpdate: "notice", severity: "info", title: "Fixture checks resumed" });
      update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Checking results." } });
      update({ sessionUpdate: "tool_call", toolCallId: "timer", title: "Run schedule", kind: "other",
        status: "in_progress", rawInput: { DurationSeconds: 560 } });
    }
    if (started && existsSync(join(root, "finish"))) {
      cancelWake();
      update({ sessionUpdate: "tool_call_update", toolCallId: "timer", status: "completed" });
      update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Fixture checks finished." } });
      update({ sessionUpdate: "usage_update", used: 100, size: 1000 });
    }
  }, 15);
  wakeTimer.unref();
}
let bridge;
let bridgeMcp;
const bridgePending = new Map();
const bridgeReplies = new Map();
function sendBridge(msg) {
  bridge.stdin.write(JSON.stringify(msg) + "\n");
}
function waitBridgeReply(id, timeoutMs = 15000) {
  if (bridgeReplies.has(id)) {
    const existing = bridgeReplies.get(id);
    bridgeReplies.delete(id);
    return Promise.resolve(existing);
  }
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      bridgePending.delete(id);
      reject(Error("Timed out waiting for MCP bridge reply id=" + id));
    }, timeoutMs);
    timer.unref();
    bridgePending.set(id, (reply) => {
      clearTimeout(timer);
      resolvePromise(reply);
    });
  });
}
function validateBridgeSpec(mcp) {
  assert.ok(mcp, "Expected t3-code MCP server in session/new params");
  const isNative =
    /[\\/]t3-resource-monitor(?:\.exe)?$/i.test(mcp.command) &&
    mcp.args.length === 1 &&
    mcp.args[0] === "--chronos-acp-mcp-bridge";
  if (isNative) return;
  if (process.env.CHRONOS_BENCH_EXE) {
    assert.equal(mcp.command.toLowerCase(), process.env.CHRONOS_BENCH_EXE.toLowerCase());
  }
  assert.equal(mcp.args.length, 2);
  if (process.env.CHRONOS_BENCH_ENTRY) {
    assert.equal(resolve(mcp.args[0]).toLowerCase(), resolve(process.env.CHRONOS_BENCH_ENTRY).toLowerCase());
  }
  assert.equal(mcp.args[1], "acp-mcp-bridge");
}
async function connectBridge(params) {
  if (lifecycle) assert.equal(process.env.CHRONOS_BENCH_LIFECYCLE, "1");
  const mcp = params.mcpServers.find(server => server.name === "t3-code");
  validateBridgeSpec(mcp);
  if (bridge) return;
  bridgeMcp = mcp;
  bridge = spawn(mcp.command, mcp.args, {
    env: { ...process.env, ...Object.fromEntries(mcp.env.map(v => [v.name, v.value])) },
    stdio: ["pipe", "pipe", "inherit"], windowsHide: true,
  });
  bridge.once("error", (error) => {
    for (const [id, fn] of bridgePending) {
      bridgePending.delete(id);
      fn({ id, __error: error });
    }
  });
  bridge.once("exit", (code) => {
    for (const [id, fn] of bridgePending) {
      bridgePending.delete(id);
      fn({ id, __error: Error("Bridge exited early with code " + code) });
    }
  });
  createInterface({ input: bridge.stdout }).on("line", line => {
    if (!line.trim()) return;
    const reply = JSON.parse(line);
    if (reply.id !== undefined && reply.id !== null) {
      const waiter = bridgePending.get(reply.id);
      if (waiter) {
        bridgePending.delete(reply.id);
        waiter(reply);
      } else {
        bridgeReplies.set(reply.id, reply);
      }
    }
  });
  sendBridge({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
    protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "bench", version: "1" },
  } });
  const initReply = await waitBridgeReply(1, 15000);
  if (initReply.__error) throw initReply.__error;
  assert.ok(initReply.result?.protocolVersion, "Bridge failed to initialize");
  if (bridgeBench) {
    sendBridge({ jsonrpc: "2.0", method: "notifications/initialized" });
  }
  appendFileSync(join(root, sessionId + ".pids"), JSON.stringify({ agent: process.pid, bridge: bridge.pid, method: params.sessionId ? "restore" : "new" }) + "\n");
}
async function verifyBridgeEndToEnd(threadId) {
  const call = async (id, method, params = {}) => {
    sendBridge({ jsonrpc: "2.0", id, method, params });
    const reply = await waitBridgeReply(id, 15000);
    if (reply.__error) throw reply.__error;
    return reply;
  };
  const listed = await call(2, "tools/list", {});
  const toolNames = (listed.result?.tools ?? []).map(t => t.name);
  const requiredTools = ["t3_thread_list", "t3_project_list", "t3_environment_read", "t3_thread_wait"];
  const allCoreToolsListed = requiredTools.every(name => toolNames.includes(name));
  assert.ok(allCoreToolsListed, "Missing core T3 MCP tools: " + JSON.stringify({ requiredTools, toolNames }));

  const projectsReply = await call(3, "tools/call", { name: "t3_project_list", arguments: {} });
  const projectsText = JSON.stringify(projectsReply.result ?? {});
  const projectListOk = !projectsReply.error && !projectsReply.result?.isError && projectsText.includes("Guard");
  assert.ok(projectListOk, "t3_project_list failed: " + projectsText.slice(0, 300));

  const threadsReply = await call(4, "tools/call", { name: "t3_thread_list", arguments: { allProjects: true } });
  const threadsText = JSON.stringify(threadsReply.result ?? {});
  const threadListOk = !threadsReply.error && !threadsReply.result?.isError && threadsText.includes(threadId);
  assert.ok(threadListOk, "t3_thread_list failed: " + threadsText.slice(0, 300));

  const envReply = await call(5, "tools/call", { name: "t3_environment_read", arguments: {} });
  const envReadOk = !envReply.error && !envReply.result?.isError && Boolean(envReply.result);
  assert.ok(envReadOk, "t3_environment_read failed: " + JSON.stringify(envReply).slice(0, 300));

  const missingToolReply = await call(6, "tools/call", { name: "chronos_bench_nonexistent_tool", arguments: {} });
  const unknownToolErrorOk = missingToolReply.error?.code === -32602 || missingToolReply.result?.isError === true;
  assert.ok(unknownToolErrorOk, "Expected error for nonexistent tool: " + JSON.stringify(missingToolReply));

  const badReadReply = await call(7, "tools/call", { name: "t3_thread_read", arguments: { threadId: "nonexistent-thread-id" } });
  const toolErrorOk = Boolean(badReadReply.error || badReadReply.result?.isError === true);
  assert.ok(toolErrorOk, "Expected error for nonexistent thread read: " + JSON.stringify(badReadReply));

  // Exercise live cancellation while a real blocking T3 MCP call (t3_thread_wait on this running thread) is open.
  const cancelStart = performance.now();
  sendBridge({
    jsonrpc: "2.0",
    id: 8,
    method: "tools/call",
    params: { name: "t3_thread_wait", arguments: { threadId, timeoutMs: 25000 } },
  });
  await sleep(250);
  sendBridge({
    jsonrpc: "2.0",
    method: "notifications/cancelled",
    params: { requestId: 8, reason: "bench-cancel" },
  });
  const pingReply = await call(9, "ping", {});
  const postCancelEnvReply = await call(10, "tools/call", { name: "t3_environment_read", arguments: {} });
  const cancelElapsedMs = performance.now() - cancelStart;
  const cancelAndPostCancelOk =
    !pingReply.error &&
    Boolean(pingReply.result) &&
    !postCancelEnvReply.error &&
    !postCancelEnvReply.result?.isError &&
    cancelElapsedMs < 10000;
  assert.ok(cancelAndPostCancelOk, "Post-cancel check failed (" + cancelElapsedMs + "ms)");

  const summary = {
    agent: process.pid,
    bridge: bridge.pid,
    command: bridgeMcp.command,
    args: bridgeMcp.args,
    toolCount: toolNames.length,
    sampleTools: toolNames.slice(0, 12),
    cancelElapsedMs: Math.round(cancelElapsedMs),
    verified: {
      allCoreToolsListed,
      projectListOk,
      threadListOk,
      envReadOk,
      unknownToolErrorOk,
      toolErrorOk,
      cancelAndPostCancelOk,
    },
  };
  writeFileSync(join(root, sessionId + ".bridge.json"), JSON.stringify(summary, null, 2));
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
  if (background && (method === "session/cancel" || method === "session/close")) cancelWake();
  if (id == null) continue;
  if (lifecycle && method) appendFileSync(join(root, "acp-fixture.log"), method + "\n");
  let result = {};
  if (method === "initialize") {
    result = {
      protocolVersion: 1,
      agentCapabilities: lifecycle ? { loadSession: true, sessionCapabilities: { resume: {} } } : {},
      authMethods: background ? [{ id: "oauth-personal", name: "Fixture" }] : [],
      agentInfo: { name: "chronos-bench", version: background ? "1.5.12" : "1" },
    };
  } else if (lifecycle && (method === "session/load" || method === "session/resume")) {
    sessionId = params.sessionId;
    assert.match(sessionId, /^[a-f0-9-]{36}$/);
    assert(existsSync(join(root, sessionId + ".history")));
    await connectBridge(params);
    result = { models: { currentModelId: "bench", availableModels: [{ modelId: "bench", name: "Bench" }] } };
  } else if (method === "session/new") {
    if (lifecycle || bridgeBench) await connectBridge(params);
    result = {
      sessionId,
      ...(background ? { modes: { currentModeId: "yolo", availableModes: [{ id: "yolo", name: "Fixture" }] } } : {}),
      models: { currentModelId: "bench", availableModels: [{ modelId: "bench", name: "Bench" }] },
    };
  } else if ((lifecycle || bridgeBench || background) && method === "session/set_config_option") {
    result = { configOptions: [] };
  } else if (background && method === "session/prompt") {
    assert.equal(wakeTimer, undefined, "a native wake does not take another prompt");
    appendFileSync(join(root, "prompts"), "prompt\n");
    send({ id, result: { stopReason: "end_turn" } });
    startWake();
    continue;
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
    if (bridgeBench) {
      await verifyBridgeEndToEnd(thread);
      send({ method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Bridge verified" } } } });
      send({ id, result: { stopReason: "end_turn" } });
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
if (bridge) {
  try { bridge.stdin.end(); } catch {}
}

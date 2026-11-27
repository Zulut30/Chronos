import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { dirname, basename, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

test("ACP emits distinct ordered markers after the start barrier and exits with end_turn", async () => {
  const root = await mkdtemp(join(tmpdir(), "chronos-bench-test-"));
  const id = crypto.randomUUID();
  const child = spawn(process.execPath, [join(import.meta.dirname, "agent.mjs"), root, "3", "5"], {
    stdio: ["pipe","pipe","inherit"], windowsHide: true,
  });
  const lines = createInterface({ input: child.stdout });
  const frames = [];
  lines.on("line", (line) => frames.push(JSON.parse(line)));
  try {
    child.stdin.write(JSON.stringify({ id: 1, method: "session/prompt", params: { prompt: "bench-" + id } }) + "\n");
    const deadline = Date.now() + 5000;
    while (!(await stat(join(root, id + ".ready")).catch(() => false))) {
      assert(Date.now() < deadline);
      await sleep(10);
    }
    assert.equal(frames.length, 0);
    const exit = once(child, "exit", { signal: AbortSignal.timeout(5000) });
    await writeFile(join(root, "go"), "");
    child.stdin.end();
    assert.equal((await exit)[0], 0);
    assert.equal(frames.at(-1).result.stopReason, "end_turn");
    const chunks = frames.slice(0, -1).map((frame) => frame.params.update.content.text);
    assert.deepEqual(chunks.map((chunk) => chunk.match(/_(\d+)_/)[1]), ["0","1","2"]);
    assert.equal(chunks.join(""), await readFile(join(root, id + ".txt"), "utf8"));
  } finally {
    if (child.exitCode === null) child.kill();
    lines.close();
    if (dirname(resolve(root)) === resolve(tmpdir()) && basename(root).startsWith("chronos-bench-test-")) {
      await rm(root, { recursive: true, force: true, maxRetries: 3 });
    }
  }
});

test("code fixture reports independent turn tokens and cumulative ACP cost", async () => {
  const root = await mkdtemp(join(tmpdir(), "chronos-bench-test-"));
  try {
    const frame = { id: 1, method: "session/prompt", params: {
      prompt: "SEED_HISTORY SPEED_TOKENS_509 bench-" + crypto.randomUUID(),
    } };
    const child = spawnSync(process.execPath, [join(import.meta.dirname, "agent.mjs"), root, "1", "1", "code"], {
      input: JSON.stringify(frame) + "\n", encoding: "utf8", timeout: 5000, windowsHide: true,
    });
    assert.equal(child.status, 0, child.stderr);
    const frames = child.stdout.trim().split("\n").map(line => JSON.parse(line));
    assert.deepEqual(frames.at(-1).result.usage, { totalTokens: 3009, inputTokens: 2500, outputTokens: 509 });
    assert.deepEqual(frames.at(-2).params.update.cost, { amount: 0.42, currency: "USD" });
  } finally {
    if (dirname(resolve(root)) === resolve(tmpdir()) && basename(root).startsWith("chronos-bench-test-")) {
      await rm(root, { recursive: true, force: true, maxRetries: 3 });
    }
  }
});

test("native timer wakes after end_turn on the same ACP transport", async () => {
  const root = await mkdtemp(join(tmpdir(), "chronos-bench-test-"));
  const child = spawn(process.execPath, [join(import.meta.dirname, "agent.mjs"), root, "0", "0", "antigravity-background"],
    { stdio: ["pipe", "pipe", "inherit"], windowsHide: true });
  const lines = createInterface({ input: child.stdout });
  const frames = lines[Symbol.asyncIterator]();
  const next = async () => JSON.parse((await frames.next()).value);
  try {
    child.stdin.write(JSON.stringify({ id: 1, method: "session/prompt", params: {} }) + "\n");
    assert.equal((await next()).result.stopReason, "end_turn");
    await writeFile(join(root, "wake"), "");
    assert.equal((await next()).params.update.title, "Fixture checks resumed");
    assert.equal((await next()).params.update.sessionUpdate, "agent_thought_chunk");
    assert.equal((await next()).params.update.status, "in_progress");
    await writeFile(join(root, "finish"), "");
    assert.equal((await next()).params.update.status, "completed");
    assert.equal((await next()).params.update.content.text, "Fixture checks finished.");
    assert.equal((await next()).params.update.sessionUpdate, "usage_update");
    assert.equal(await readFile(join(root, "prompts"), "utf8"), "prompt\n");
  } finally {
    child.stdin.end();
    lines.close();
    if (child.exitCode === null) child.kill();
    if (dirname(resolve(root)) === resolve(tmpdir()) && basename(root).startsWith("chronos-bench-test-")) {
      await rm(root, { recursive: true, force: true, maxRetries: 3 });
    }
  }
});

test("acp-bridge fixture verifies T3 MCP tools, errors, and live cancellation end-to-end", async () => {
  const root = await mkdtemp(join(tmpdir(), "chronos-bench-test-"));
  const threadId = crypto.randomUUID();
  const mockBridge = join(root, "mock-bridge.mjs");
  await writeFile(
    mockBridge,
    [
      "import { createInterface } from 'node:readline';",
      "const out = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\\n');",
      "const pendingWait = new Map();",
      "for await (const line of createInterface({ input: process.stdin })) {",
      "  if (!line.trim()) continue;",
      "  const msg = JSON.parse(line);",
      "  if (msg.method === 'initialize') out({ id: msg.id, result: { protocolVersion: '2025-06-18' } });",
      "  else if (msg.method === 'tools/list') out({ id: msg.id, result: { tools: [",
      "    { name: 't3_thread_list' }, { name: 't3_project_list' }, { name: 't3_environment_read' }, { name: 't3_thread_wait' }",
      "  ] } });",
      "  else if (msg.method === 'tools/call') {",
      "    const name = msg.params?.name;",
      "    if (name === 't3_project_list') out({ id: msg.id, result: { structuredContent: { projects: [{ title: 'Guard' }] } } });",
      "    else if (name === 't3_thread_list') out({ id: msg.id, result: { structuredContent: { threads: [{ threadId: " + JSON.stringify(threadId) + " }] } } });",
      "    else if (name === 't3_environment_read') out({ id: msg.id, result: { structuredContent: { ok: true } } });",
      "    else if (name === 'chronos_bench_nonexistent_tool') out({ id: msg.id, error: { code: -32602, message: 'Unknown tool' } });",
      "    else if (name === 't3_thread_read') out({ id: msg.id, result: { isError: true, content: [{ text: 'Thread not found' }] } });",
      "    else if (name === 't3_thread_wait') pendingWait.set(msg.id, true);",
      "  } else if (msg.method === 'notifications/cancelled') { pendingWait.delete(msg.params?.requestId); }",
      "  else if (msg.method === 'ping') out({ id: msg.id, result: {} });",
      "}",
    ].join("\n"),
  );
  const child = spawn(process.execPath, [join(import.meta.dirname, "agent.mjs"), root, "1", "1", "acp-bridge"], {
    stdio: ["pipe", "pipe", "inherit"],
    windowsHide: true,
    env: {
      ...process.env,
      CHRONOS_BENCH_EXE: process.execPath,
      CHRONOS_BENCH_ENTRY: mockBridge,
    },
  });
  const lines = createInterface({ input: child.stdout });
  const frames = lines[Symbol.asyncIterator]();
  const next = async () => JSON.parse((await frames.next()).value);
  try {
    child.stdin.write(JSON.stringify({ id: 1, method: "initialize", params: {} }) + "\n");
    assert.equal((await next()).id, 1);
    child.stdin.write(
      JSON.stringify({
        id: 2,
        method: "session/new",
        params: {
          mcpServers: [
            {
              name: "t3-code",
              command: process.execPath,
              args: [mockBridge, "acp-mcp-bridge"],
              env: [],
            },
          ],
        },
      }) + "\n",
    );
    const created = await next();
    const sessionId = created.result.sessionId;
    assert.ok(sessionId);
    child.stdin.write(
      JSON.stringify({
        id: 3,
        method: "session/prompt",
        params: { sessionId, prompt: [{ type: "text", text: "VERIFY_BRIDGE bench-" + threadId }] },
      }) + "\n",
    );
    const update = await next();
    assert.equal(update.params.update.content.text, "Bridge verified");
    const done = await next();
    assert.equal(done.result.stopReason, "end_turn");
    const report = JSON.parse(await readFile(join(root, sessionId + ".bridge.json"), "utf8"));
    assert.equal(report.toolCount, 4);
    for (const [key, value] of Object.entries(report.verified)) {
      assert.equal(value, true, "Expected verified." + key);
    }
  } finally {
    child.stdin.end();
    lines.close();
    if (child.exitCode === null) child.kill();
    if (dirname(resolve(root)) === resolve(tmpdir()) && basename(root).startsWith("chronos-bench-test-")) {
      await rm(root, { recursive: true, force: true, maxRetries: 3 });
    }
  }
});

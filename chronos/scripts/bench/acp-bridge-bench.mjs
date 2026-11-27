// Paired Windows benchmark: measures private commit and process count for one Antigravity thread
// (mock ACP agent + T3 MCP bridge) without real models while verifying live T3 MCP tools, errors,
// and cancellation end-to-end against the packaged Chronos server.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { rpcClient } from "./client.mjs";
import { createSandbox } from "./sandbox.mjs";

const [distribution, output] = process.argv.slice(2);
assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
assert.equal(process.platform, "win32");
assert.ok(distribution && output, "Usage: node acp-bridge-bench.mjs <distribution> <output.json>");

const sb = createSandbox(1, 1);
const exe = resolve(distribution, "Chronos.exe");
const entry = resolve(distribution, "resources/server.asar/apps/server/dist/bin.mjs");
const env = sb.env;
const settingsFile = join(sb.userdata, "settings.json");
const settings = JSON.parse(readFileSync(settingsFile, "utf8"));
delete settings.backgroundActivityProfile;
const port = await sb.port();
const origin = "http://127.0.0.1:" + port;

const post = async (path, body, bearer) => {
  const r = await fetch(origin + path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + bearer },
    body: JSON.stringify(body),
  });
  assert(r.ok, path + " HTTP " + r.status);
  return r;
};

const sampleTree = (rootPid, serverPid = 0) =>
  JSON.parse(
    execFileSync(
      "pwsh",
      [
        "-NoProfile",
        "-File",
        join(import.meta.dirname, "tree-memory.ps1"),
        "-RootPid",
        String(rootPid),
        "-ServerPid",
        String(serverPid),
      ],
      { encoding: "utf8", timeout: 20000 },
    ),
  );

const samplePair = (agentPid, bridgePid) =>
  JSON.parse(
    execFileSync(
      "pwsh",
      [
        "-NoProfile",
        "-File",
        join(import.meta.dirname, "acp-processes.ps1"),
        String(agentPid),
        String(bridgePid),
      ],
      { encoding: "utf8", timeout: 15000 },
    ),
  );

let rpc;
let startupErrors = "";
try {
  // Provision mock agy.exe (Node running agent.mjs in acp-bridge mode) with network blocked.
  const binary = join(sb.root, "agy.exe");
  copyFileSync(process.execPath, binary);
  const fixture = pathToFileURL(join(import.meta.dirname, "agent.mjs")).href;
  const fixtureLog = JSON.stringify(join(sb.root, "acp-fixture.log"));
  writeFileSync(
    join(sb.work, "acp"),
    [
      "const { appendFileSync } = require('node:fs');",
      "appendFileSync(" + fixtureLog + ", 'starting acp-bridge fixture\\n');",
      "process.argv = [process.execPath, 'fixture', " + JSON.stringify(sb.root) + ", '1', '1', 'acp-bridge'];",
      "import(" + JSON.stringify(fixture) + ").catch(error => {",
      "  appendFileSync(" + fixtureLog + ", String(error.stack) + '\\n');",
      "  process.exit(1);",
      "});",
    ].join("\n"),
  );
  Object.assign(env, {
    CHRONOS_BENCH_EXE: exe,
    CHRONOS_BENCH_ENTRY: entry,
    HTTP_PROXY: "http://127.0.0.1:9",
    HTTPS_PROXY: "http://127.0.0.1:9",
    NO_PROXY: "127.0.0.1,localhost",
  });
  settings.providerInstances.antigravity = {
    driver: "antigravity",
    enabled: true,
    config: { binaryPath: binary },
  };
  settings.defaultModelSelection = { instanceId: "antigravity", model: "antigravity-default" };
  writeFileSync(settingsFile, JSON.stringify(settings));

  const app = sb.start(
    exe,
    [entry, "serve", "--base-dir", sb.home, "--port", String(port), "--host", "127.0.0.1", "--no-browser"],
    { ...env, ELECTRON_RUN_AS_NODE: "1" },
  );
  for (const stream of [app.stdout, app.stderr]) {
    stream.on("data", (chunk) => {
      const lines = String(chunk)
        .split("\n")
        .filter((line) => /error|cause|failure/i.test(line));
      startupErrors = (startupErrors + lines.join("\n")).slice(-9000);
    });
  }

  const stateFile = join(sb.userdata, "server-runtime.json");
  const state = await sb.wait(
    "private server",
    () => existsSync(stateFile) && JSON.parse(readFileSync(stateFile, "utf8")),
  );
  assert.equal(state.origin, origin);
  assert.equal(state.pid, app.pid);

  const bearer = sb
    .run(exe, [entry, "auth", "session", "issue", "--token-only", "--label", "acp-bridge-bench"], {
      ...env,
      ELECTRON_RUN_AS_NODE: "1",
    })
    .trim();
  const projectId = crypto.randomUUID();
  const threadId = crypto.randomUUID();
  await post(
    "/api/projects/mutate",
    { type: "project.create", commandId: crypto.randomUUID(), projectId, title: "Guard", workspaceRoot: sb.work },
    bearer,
  );
  const { ticket } = await (await post("/api/auth/websocket-ticket/rpc", {}, bearer)).json();
  rpc = await rpcClient(
    origin.replace("http:", "ws:") + "/ws?orchestrationProtocol=2&wsTicket=" + encodeURIComponent(ticket),
  );

  const start = performance.now();
  await rpc.call("orchestration.launchThread", {
    commandId: crypto.randomUUID(),
    threadId,
    projectId,
    title: "Guard",
    generateTitle: false,
    modelSelection: settings.defaultModelSelection,
    runtimeMode: "approval-required",
    interactionMode: "default",
    workspaceStrategy: { type: "root" },
    initialMessage: { text: "VERIFY_BRIDGE bench-" + threadId, attachments: [] },
  });

  const projection = await sb.wait("ACP bridge verified", async () => {
    const p = await rpc.call("orchestration.getThreadProjection", { threadId });
    if (p.runs.at(-1)?.status === "failed") {
      throw Error(
        JSON.stringify([p.providerSessions.at(-1)?.lastError, p.turnItems.at(-1)?.failure]),
      );
    }
    return (
      p.runs.length === 1 &&
      p.runs[0].status === "completed" &&
      p.turnItems.some((i) => i.type === "assistant_message" && i.text?.trim() === "Bridge verified") &&
      p
    );
  }, 60000);
  const turnElapsedMs = Math.round(performance.now() - start);

  const nativeId = projection.providerThreads.at(-1)?.nativeThreadRef?.nativeId;
  assert.match(nativeId, /^[a-f0-9-]{36}$/);
  const bridgeReportPath = join(sb.root, nativeId + ".bridge.json");
  assert.ok(existsSync(bridgeReportPath), "Expected bridge verification report at " + bridgeReportPath);
  const bridgeReport = JSON.parse(readFileSync(bridgeReportPath, "utf8"));
  for (const [check, ok] of Object.entries(bridgeReport.verified)) {
    assert.equal(ok, true, "Bridge functional check failed: " + check);
  }

  // Let both processes reach steady-state after completing all MCP tool calls and cancellation.
  await sleep(5000);

  const pair = samplePair(bridgeReport.agent, bridgeReport.bridge);
  assert.equal(pair.count, 2, "Expected both mock agent and MCP bridge alive");
  const threadTree = sampleTree(bridgeReport.agent, 0);
  const serverTree = sampleTree(app.pid, app.pid);

  const result = {
    scenario: "acp-bridge",
    turnElapsedMs,
    bridgeCommand: basename(bridgeReport.command),
    bridgeArgs: bridgeReport.args,
    toolCount: bridgeReport.toolCount,
    sampleTools: bridgeReport.sampleTools,
    cancelElapsedMs: bridgeReport.cancelElapsedMs,
    verified: bridgeReport.verified,
    agent: pair.agent,
    bridge: pair.bridge,
    pairPrivateMiB: Number(pair.privateMiB.toFixed(3)),
    pairCount: pair.count,
    threadTree: {
      processCount: threadTree.total.count,
      privateMiB: threadTree.total.privateMiB,
      wsMiB: threadTree.total.wsMiB,
      threads: threadTree.total.threads,
      processes: threadTree.processes,
    },
    server: serverTree.server,
  };
  writeFileSync(output, JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify({
      bridgeCommand: result.bridgeCommand,
      bridgePrivateMiB: Number(result.bridge.privateMiB.toFixed(2)),
      bridgeWsMiB: Number(result.bridge.wsMiB.toFixed(2)),
      agentPrivateMiB: Number(result.agent.privateMiB.toFixed(2)),
      threadProcessCount: result.threadTree.processCount,
      threadPrivateMiB: result.threadTree.privateMiB,
      toolCount: result.toolCount,
      verified: result.verified,
    }),
  );
} catch (error) {
  const fixtureLog = join(sb.root, "acp-fixture.log");
  if (existsSync(fixtureLog)) console.error(readFileSync(fixtureLog, "utf8").slice(-3000));
  if (startupErrors) {
    console.error(startupErrors.replace(/(Bearer\s+|token[=: ]+)\S+/gi, "$1[redacted]"));
  }
  throw error;
} finally {
  rpc?.close();
  await sb.cleanup();
}

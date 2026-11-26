import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { connectCdp, rpcClient } from "./client.mjs";
import { createSandbox } from "./sandbox.mjs";

const [distribution, scenario, output, claudeExperiment] = process.argv.slice(2);
assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
assert.equal(process.platform, "win32");
assert(["unused", "disabled", "claudeAgent", "codex"].includes(scenario));
if (claudeExperiment) {
  assert.equal(scenario, "claudeAgent");
  assert(["default", "smol", "gc", "idle-base", "idle-head"].includes(claudeExperiment));
}
const idleExperiment = claudeExperiment?.startsWith("idle-");
let experimentResult;
const idle = ["unused", "disabled"].includes(scenario);
const sb = createSandbox(1, 1);
const exe = resolve(distribution, "Chronos.exe");
const entry = resolve(distribution, "resources/server.asar/apps/server/dist/bin.mjs");
const env = sb.env;
const settingsFile = join(sb.userdata, "settings.json");
const settings = JSON.parse(readFileSync(settingsFile));
delete settings.backgroundActivityProfile;
const port = await sb.port();
const origin = "http://127.0.0.1:" + port;
let cdp, rpc, mock, binary;
const post = async (path, body, bearer) => {
  const r = await fetch(origin + path, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + bearer }, body: JSON.stringify(body) });
  assert(r.ok, path + " HTTP " + r.status);
  return r;
};
try {
  let invoked = false;
  const model = scenario === "codex" ? "gpt-5.4" : "claude-sonnet-4-6";
  if (!idle) {
    binary = process.env[scenario === "codex" ? "BENCH_CODEX" : "BENCH_CLAUDE"];
    assert(binary && existsSync(binary), "Expected pinned vendor executable");
    const { claudeMock } = claudeExperiment ? await import("./claude-experiment.mjs") : {};
    mock = createServer((req, res) => {
      if (claudeExperiment && req.method === "POST" && /^\/v1\/messages(\?|$)/.test(req.url)) {
        void claudeMock(req, res).catch(error => { console.error(error); res.destroy(); });
        return;
      }
      req.resume();
      if (req.method === "POST" && /\/(responses|messages)(\?|$)/.test(req.url)) {
        invoked = true; // Hold the native session open at its first model request.
      } else {
        res.writeHead(200, { "content-type": "application/json" }).end('{"data":[]}');
      }
    });
    await new Promise(resolve => mock.listen(0, "127.0.0.1", resolve));
    const api = "http://127.0.0.1:" + mock.address().port;
    Object.assign(env, {
      OPENAI_BASE_URL: api + "/v1", OPENAI_API_KEY: "bench-local", ANTHROPIC_BASE_URL: api,
      ANTHROPIC_API_KEY: "bench-local", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      CLAUDE_CODE_GIT_BASH_PATH: join(process.env.ProgramFiles, "Git/bin/bash.exe"),
      HTTP_PROXY: "http://127.0.0.1:9", HTTPS_PROXY: "http://127.0.0.1:9", NO_PROXY: "localhost,127.0.0.1",
    });
    if (claudeExperiment === "smol") env.BUN_OPTIONS = "--smol";
    if (claudeExperiment === "gc") env.BUN_JSC_aggressiveHeapThresholdInMB = "64";
    if (idleExperiment) {
      // Simulate the threshold crossing without starving the VM or changing OS state.
      env.CHRONOS_CLAUDE_LOW_MEMORY_MIB = "1048576";
      settings.claudeIdleUnloadMinutes = 10;
    }
    mkdirSync(env.CODEX_HOME, { recursive: true });
    writeFileSync(join(env.CODEX_HOME, "config.toml"), 'model_provider = "bench"\n[model_providers.bench]\nname = "bench"\nwire_api = "responses"\nbase_url = "' + api + '/v1"\n');
    writeFileSync(join(env.CODEX_HOME, "auth.json"), JSON.stringify({ OPENAI_API_KEY: "bench-local" }));
    settings.providerInstances[scenario] = { driver: scenario, enabled: true, config: { binaryPath: binary } };
    settings.defaultModelSelection = { instanceId: scenario, model };
  }
  if (idle) {
    // Both packages see identical profile bytes. On builds with PC control this
    // exercises policy restoration without allowing a target or invoking a tool.
    const dir = join(sb.home, "pc-control");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "policy.json"), JSON.stringify({ enabled: scenario === "unused", all: false, apps: [], mode: "every" }));
  }
  writeFileSync(settingsFile, JSON.stringify(settings));
  const debug = await sb.port();
  const app = idle
    ? sb.start(exe, ["--remote-debugging-port=" + debug, "--user-data-dir=" + sb.profile], { ...env, T3CODE_PORT: String(port) })
    : sb.start(exe, [entry, "serve", "--base-dir", sb.home, "--port", String(port), "--host", "127.0.0.1", "--no-browser"], { ...env, ELECTRON_RUN_AS_NODE: "1" });
  const stateFile = join(sb.userdata, "server-runtime.json");
  const state = await sb.wait("private server", () => existsSync(stateFile) && JSON.parse(readFileSync(stateFile)));
  assert.equal(state.origin, origin);
  let pcControl;
  if (idle) {
    const pages = "http://127.0.0.1:" + debug + "/json/list";
    const page = await sb.wait("Chronos window", async () => (await (await fetch(pages)).json()).find(t => t.url.startsWith("t3code://app") && t.type === "page"));
    cdp = await connectCdp(page.webSocketDebuggerUrl);
    const evaluate = async expression => (await cdp.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
    // Electron can discard the old JavaScript context between a CDP request and its reply.
    const ready = async (condition = "true") => {
      try {
        return await evaluate("!!window.__TSR_ROUTER__?.navigate && document.readyState === 'complete' && (" + condition + ")");
      } catch (error) {
        if (/Inspected target navigated|[Ee]xecution context was destroyed|Cannot find context/.test(error.message)) return false;
        throw error;
      }
    };
    await sb.wait("renderer ready", ready);
    if (scenario === "disabled") {
      const { featureIds, featureKey } = await import(pathToFileURL(resolve(distribution, "../featureFlags.mts")));
      await evaluate(JSON.stringify(featureIds.map(featureKey)) + ".forEach(k => localStorage.setItem(k,'0')); setTimeout(() => location.reload(), 0); true");
      await sb.wait("disabled modules after reload", () => ready(JSON.stringify(featureIds) + ".every(id => globalThis.__chronosOlympusDisabled?.has(id))"));
    }
    if (await evaluate("typeof window.chronosPC?.settings === 'function'")) {
      pcControl = await evaluate("window.chronosPC.settings({op:'state'}).then(s => s.settings.enabled)");
      assert.equal(pcControl, scenario === "unused", "PC control did not restore the expected idle policy");
    }
    await sleep(30000);
  } else {
    assert.equal(state.pid, app.pid);
    const bearer = sb.run(exe, [entry, "auth", "session", "issue", "--token-only", "--label", "guard"], { ...env, ELECTRON_RUN_AS_NODE: "1" }).trim();
    const projectId = crypto.randomUUID(), threadId = crypto.randomUUID();
    await post("/api/projects/mutate", { type: "project.create", commandId: crypto.randomUUID(), projectId, title: "Guard", workspaceRoot: sb.work }, bearer);
    const { ticket } = await (await post("/api/auth/websocket-ticket/rpc", {}, bearer)).json();
    rpc = await rpcClient(origin.replace("http:", "ws:") + "/ws?orchestrationProtocol=2&wsTicket=" + encodeURIComponent(ticket));
    const launch = (id, text) => rpc.call("orchestration.launchThread", { commandId: crypto.randomUUID(), threadId: id, projectId, title: "Guard", generateTitle: false, modelSelection: settings.defaultModelSelection, runtimeMode: "approval-required", interactionMode: "default", workspaceStrategy: { type: "root" }, initialMessage: { text, attachments: [] } });
    if (claudeExperiment) {
      const { measureClaude } = await import("./claude-experiment.mjs");
      experimentResult = await measureClaude({ launch, rpc, sb, app, binary, threadId, idleExperiment, expectUnload: claudeExperiment === "idle-head" });
    } else {
      await launch(threadId, "Say OK");
      await sb.wait("native " + scenario + " model request", async () => {
        if (invoked) return true;
        const { runs } = await rpc.call("orchestration.getThreadProjection", { threadId });
        const run = runs.at(-1);
        if (run && ["failed", "completed", "interrupted"].includes(run.status)) throw Error(JSON.stringify(run).slice(-1600));
        await sleep(500);
        return false;
      }, 90000);
      await sleep(2000);
    }
  }
  const args = ["-NoProfile", "-File", join(import.meta.dirname, "guard-process.ps1"), "-RootPid", String(app.pid), "-ServerPid", String(state.pid)];
  if (binary) args.push("-AgentExe", binary);
  if (claudeExperiment) args.push("-MemoryMap");
  const sample = idleExperiment ? {} : JSON.parse(execFileSync("pwsh", args, { encoding: "utf8", timeout: 75000 }));
  if (claudeExperiment) Object.assign(sample, { claudeExperiment }, experimentResult);
  if (idle) sample.pcControl = pcControl ?? "unavailable";
  if (idle && process.env.BENCH_IDLE_MODULES === "1") {
    // Inspect the existing page only after the OS process sample has finished.
    const heap = await cdp.call("Runtime.getHeapUsage");
    const scripts = new Set();
    const unsubscribe = cdp.listen(({ method, params }) => {
      if (method === "Debugger.scriptParsed" && params.url.startsWith("t3code://app/")) {
        scripts.add(new URL(params.url).pathname);
      }
    });
    await cdp.call("Debugger.enable");
    unsubscribe();
    sample.rendererHeap = { usedMiB: heap.usedSize / 1048576, capacityMiB: heap.totalSize / 1048576 };
    sample.appScripts = [...scripts].sort();
  }
  writeFileSync(output, JSON.stringify(sample, null, 2) + "\n");
} finally {
  rpc?.close();
  cdp?.close();
  mock?.closeAllConnections();
  mock?.close();
  sb.close();
}

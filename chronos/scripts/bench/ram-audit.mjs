// Focused Windows RAM diagnostic: server isolate/worker breakdown, ACP MCP bridge footprint,
// 1-thread memory, 50 thread switches heap/DOM leak check, and minimize memory release check.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
import { connectCdp, rpcClient } from "./client.mjs";
import { createSandbox } from "./sandbox.mjs";

const [distribution, output] = process.argv.slice(2);
assert(distribution && output, "Usage: node ram-audit.mjs <unpacked Chronos dir> <output.json>");
assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted", "Requires a disposable CI VM");
assert.equal(process.platform, "win32");

const exe = resolve(distribution, "Chronos.exe");
const entry = resolve(distribution, "resources/server.asar/apps/server/dist/bin.mjs");
const treeScript = join(import.meta.dirname, "tree-memory.ps1");
const diagPreload = join(import.meta.dirname, "server-diag.cjs");

function sampleTree(rootPid, serverPid = 0) {
  return JSON.parse(
    execFileSync("pwsh", ["-NoProfile", "-File", treeScript, "-RootPid", String(rootPid), "-ServerPid", String(serverPid)], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 30000,
    }),
  );
}

function sqliteStats(userdata) {
  const file = join(userdata, "statev2.sqlite");
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout=5000;");
    const scalar = (q) => Object.values(db.prepare(q).get())[0];
    return {
      pageSize: scalar("PRAGMA page_size"),
      pageCount: scalar("PRAGMA page_count"),
      cacheSize: scalar("PRAGMA cache_size"),
      sizesKiB: Object.fromEntries(
        ["", "-wal", "-shm"].map((ext) => [ext || "main", existsSync(file + ext) ? Number((statSync(file + ext).size / 1024).toFixed(1)) : 0]),
      ),
    };
  } finally {
    db.close();
  }
}

async function runServerDiag() {
  const sb = createSandbox(1, 1);
  try {
    const port = await sb.port();
    const serverEnv = { ...sb.env, ELECTRON_RUN_AS_NODE: "1", CHRONOS_RAM_DIAG_ROOT: sb.root };
    const proc = sb.start(exe, ["--require", diagPreload, entry, "serve", "--base-dir", sb.home, "--port", String(port), "--host", "127.0.0.1", "--no-browser"], serverEnv);
    const stateFile = join(sb.userdata, "server-runtime.json");
    const state = await sb.wait("diag server", () => existsSync(stateFile) && JSON.parse(readFileSync(stateFile, "utf8")));
    assert.equal(state.pid, proc.pid);
    await sleep(30000);
    const marker = join(sb.root, "diag-trigger");
    writeFileSync(marker, "");
    const diag = await sb.wait("diag sample", () => existsSync(marker + ".json") && JSON.parse(readFileSync(marker + ".json", "utf8")), 10000);
    const procMem = sampleTree(proc.pid, proc.pid);
    return {
      ...diag,
      processPrivateMiB: procMem.total.privateMiB,
      processWsMiB: procMem.total.wsMiB,
      osThreads: procMem.total.threads,
      sqlite: sqliteStats(sb.userdata),
    };
  } finally {
    sb.close();
  }
}

function controlWindow(pid, cmd, existingHwnd = 0) {
  const script = `
Add-Type -Namespace Win32 -Name Native -MemberDefinition '
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder lpClassName, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  public struct RECT { public int Left, Top, Right, Bottom; }
'
$h = [IntPtr]${existingHwnd}
if ($h -eq [IntPtr]::Zero) {
  $p = Get-Process -Id ${pid} -ErrorAction Stop
  $p.Refresh()
  $h = $p.MainWindowHandle
}
if ($h -eq [IntPtr]::Zero) {
  $candidates = [System.Collections.Generic.List[object]]::new()
  $cb = [Win32.Native+EnumWindowsProc]{
    param($w, $l)
    [uint32]$wpid = 0
    [void][Win32.Native]::GetWindowThreadProcessId($w, [ref]$wpid)
    if ([int]$wpid -eq ${pid}) {
      $sb = [System.Text.StringBuilder]::new(128)
      [void][Win32.Native]::GetClassName($w, $sb, $sb.Capacity)
      if ($sb.ToString() -eq 'Chrome_WidgetWin_1') {
        $r = New-Object Win32.Native+RECT
        [void][Win32.Native]::GetWindowRect($w, [ref]$r)
        $candidates.Add([pscustomobject]@{
          h = $w
          vis = [Win32.Native]::IsWindowVisible($w)
          area = [Math]::Max(0, $r.Right - $r.Left) * [Math]::Max(0, $r.Bottom - $r.Top)
        })
      }
    }
    return $true
  }
  [void][Win32.Native]::EnumWindows($cb, [IntPtr]::Zero)
  $pick = $candidates | Where-Object { $_.vis -and $_.area -gt 40000 } | Sort-Object area -Descending | Select-Object -First 1
  if (-not $pick) { $pick = $candidates | Sort-Object area -Descending | Select-Object -First 1 }
  if ($pick) { $h = $pick.h }
}
if ($h -eq [IntPtr]::Zero) { throw "No window handle found for PID ${pid}" }
[void][Win32.Native]::ShowWindow($h, ${cmd})
Start-Sleep -Milliseconds 400
[pscustomobject]@{ hwnd = $h.ToInt64(); iconic = [Win32.Native]::IsIconic($h) } | ConvertTo-Json -Compress
`;
  return JSON.parse(
    execFileSync("pwsh", ["-NoProfile", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15000,
    }),
  );
}

async function runAcpMcpBridgeDiag() {
  const sb = createSandbox(1, 1);
  let server, child;
  try {
    const pendingStreams = new Map();
    let sessionReplayed = false;
    let protocolReplayed = false;
    let cancelForwarded = false;
    server = createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        if (req.headers.authorization !== "Bearer ram-audit") {
          res.writeHead(401).end();
          return;
        }
        const msg = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (msg.method === "initialize") {
          res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "ram-audit-session" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18" } }));
          return;
        }
        if (req.headers["mcp-session-id"] === "ram-audit-session") sessionReplayed = true;
        if (req.headers["mcp-protocol-version"] === "2025-06-18") protocolReplayed = true;
        if (msg.method === "notifications/initialized") {
          res.writeHead(202).end();
          return;
        }
        if (msg.method === "tools/list") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: { tools: [{ name: "t3_thread_list" }, { name: "tool_search" }, { name: "slow_tool" }] },
          }));
          return;
        }
        if (msg.method === "tools/call" && msg.params?.name === "t3_thread_list") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: { structuredContent: { threads: [] }, content: [] },
          }));
          return;
        }
        if (msg.method === "tools/call" && msg.params?.name === "tool_search") {
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.write('data: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}\n\n');
          res.write(`data: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { structuredContent: { tools: [{ name: "preview_open" }] } } })}\n\n`);
          res.end();
          return;
        }
        if (msg.method === "tools/call" && msg.params?.name === "missing_tool") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            error: { code: -32602, message: "Tool not found" },
          }));
          return;
        }
        if (msg.method === "tools/call" && msg.params?.name === "slow_tool") {
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.write('data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}\n\n');
          pendingStreams.set(msg.id, res);
          return;
        }
        if (msg.method === "notifications/cancelled") {
          const reqId = msg.params?.requestId;
          const stream = pendingStreams.get(reqId);
          if (stream) {
            cancelForwarded = true;
            pendingStreams.delete(reqId);
            stream.end();
          }
          res.writeHead(202).end();
          return;
        }
        if (msg.method === "ping") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }));
          return;
        }
        res.writeHead(404).end();
      });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    child = spawn(exe, [entry, "acp-mcp-bridge"], {
      cwd: sb.work,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...sb.env,
        ELECTRON_RUN_AS_NODE: "1",
        T3_ACP_MCP_ENDPOINT: `http://127.0.0.1:${port}/mcp`,
        T3_ACP_MCP_AUTHORIZATION: "Bearer ram-audit",
      },
    });
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err = (err + d).slice(-800); });
    const parsed = () => {
      const lines = out.split(/\r?\n/);
      lines.pop();
      return lines.filter(Boolean).map((line) => JSON.parse(line));
    };
    const send = (msg) => child.stdin.write(JSON.stringify(msg) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "ram-audit", version: "1.0.0" } } });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "t3_thread_list", arguments: {} } });
    send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "tool_search", arguments: { query: "preview" } } });
    send({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "missing_tool", arguments: {} } });
    send({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "slow_tool", arguments: {} } });
    await sb.wait("acp-mcp-bridge slow_tool open", () => {
      if (child.exitCode !== null) throw Error("acp-mcp-bridge exited early: " + child.exitCode + " " + err);
      return parsed().some((m) => m.method === "notifications/progress");
    }, 15000);
    send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 6, reason: "ram-audit" } });
    send({ jsonrpc: "2.0", id: 7, method: "ping", params: {} });
    await sb.wait("acp-mcp-bridge replies", () => {
      if (child.exitCode !== null) throw Error("acp-mcp-bridge exited early: " + child.exitCode + " " + err);
      const msgs = parsed();
      return cancelForwarded && [1, 2, 3, 4, 5, 7].every((id) => msgs.some((m) => m.id === id));
    }, 15000);
    const msgs = parsed();
    const verified = {
      sessionReplayed,
      protocolReplayed,
      jsonToolOk: Array.isArray(msgs.find((m) => m.id === 3)?.result?.structuredContent?.threads),
      sseToolOk:
        msgs.some((m) => m.method === "notifications/tools/list_changed") &&
        msgs.find((m) => m.id === 4)?.result?.structuredContent?.tools?.[0]?.name === "preview_open",
      errorPropagated: msgs.find((m) => m.id === 5)?.error?.code === -32602,
      cancelForwarded,
      postCancelPingOk: Boolean(msgs.find((m) => m.id === 7)?.result),
    };
    for (const [k, v] of Object.entries(verified)) {
      assert.equal(v, true, "acp-mcp-bridge check failed: " + k);
    }
    await sleep(3000);
    const mem = sampleTree(child.pid, 0);
    child.stdin.end();
    if (child.exitCode === null) {
      await Promise.race([new Promise((r) => child.once("exit", r)), sleep(5000)]);
    }
    return {
      privateMiB: mem.total.privateMiB,
      wsMiB: mem.total.wsMiB,
      processCount: mem.total.count,
      threads: mem.total.threads,
      processes: mem.processes,
      verified,
    };
  } finally {
    if (child && child.exitCode === null) {
      try { execFileSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" }); } catch {}
    }
    if (server) {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
    sb.close();
  }
}

async function runDesktopAudit() {
  const sb = createSandbox(20, 40, "code");
  const { port, run, wait, env, userdata, work, profile, modelSelection } = sb;
  const nodeEnv = { ...env, ELECTRON_RUN_AS_NODE: "1" };
  const listen = await port();
  const debug = await port();
  const origin = "http://127.0.0.1:" + listen;
  const proj = crypto.randomUUID();
  const targets = Array.from({ length: 10 }, () => crypto.randomUUID());
  let rpc, cdp, app;
  try {
    // Launch without windowsHide so the Electron BrowserWindow receives a real visible Win32 HWND.
    app = spawn(
      exe,
      ["--remote-debugging-port=" + debug, "--user-data-dir=" + profile],
      { cwd: work, env: { ...env, T3CODE_PORT: String(listen) }, windowsHide: false, stdio: ["ignore", "pipe", "pipe"] },
    );
    app.stdout.resume();
    app.stderr.resume();
    const stateFile = join(userdata, "server-runtime.json");
    const state = await wait("desktop server", () => existsSync(stateFile) && JSON.parse(readFileSync(stateFile, "utf8")));
    assert.equal(state.origin, origin);
    const getCdp = async (p) => (await fetch("http://127.0.0.1:" + debug + p)).json();
    const version = await wait("CDP version", () => getCdp("/json/version").catch(() => false));
    cdp = await connectCdp(version.webSocketDebuggerUrl);
    const target = await wait("Chronos window", async () =>
      (await getCdp("/json/list")).find((t) => t.type === "page" && t.url.startsWith("t3code://app")),
    );
    const { sessionId } = await cdp.call("Target.attachToTarget", { targetId: target.id, flatten: true });
    const page = (method, params) => cdp.call(method, params, sessionId);
    const evaluate = async (expression) => {
      const r = await page("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    };
    await page("Page.bringToFront");
    await evaluate("window.desktopBridge?.revealWindow?.().catch?.(() => undefined)").catch(() => {});

    const bearer = run(exe, [entry, "auth", "session", "issue", "--token-only", "--label", "ram-audit"], nodeEnv).trim();
    const post = async (p, body) => {
      const r = await fetch(origin + p, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + bearer },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      assert(r.ok, p + " HTTP " + r.status);
      return r;
    };
    await post("/api/projects/mutate", {
      type: "project.create",
      commandId: crypto.randomUUID(),
      projectId: proj,
      title: "RamAudit",
      workspaceRoot: work,
    });
    const { ticket } = await (await post("/api/auth/websocket-ticket/rpc", null)).json();
    rpc = await rpcClient(origin.replace("http:", "ws:") + "/ws?orchestrationProtocol=2&wsTicket=" + encodeURIComponent(ticket));
    const environment = (await (await fetch(origin + "/.well-known/t3/environment")).json()).environmentId;
    const common = {
      projectId: proj,
      modelSelection,
      runtimeMode: "approval-required",
      interactionMode: "default",
    };

    // Seed 100 sidebar fixture rows + 10 rich threads with code histories.
    for (let i = 0; i < 100; i += 10) {
      await Promise.all(
        Array.from({ length: 10 }, (_, j) =>
          rpc.call("orchestration.dispatchCommand", {
            ...common,
            createdBy: "user",
            creationSource: "web",
            branch: null,
            worktreePath: null,
            type: "thread.create",
            commandId: crypto.randomUUID(),
            threadId: crypto.randomUUID(),
            title: "Fixture " + (i + j),
          }),
        ),
      );
    }
    await Promise.all(
      targets.map((id, idx) =>
        rpc.call("orchestration.launchThread", {
          ...common,
          commandId: crypto.randomUUID(),
          threadId: id,
          title: "Seed " + idx,
          generateTitle: false,
          workspaceStrategy: { type: "root" },
          initialMessage: { text: "SEED_HISTORY bench-" + id, attachments: [] },
        }),
      ),
    );
    const finished = async (id) => (await rpc.call("orchestration.getThreadProjection", { threadId: id })).runs.at(-1)?.status === "completed";
    await wait("seeded histories", async () => (await Promise.all(targets.map(finished))).every(Boolean), 90000);

    const probe = readFileSync(join(import.meta.dirname, "../smoke/page-probes.js"), "utf8").trim().replace(/;$/, "");
    await wait("router", () => evaluate("Boolean(window.__TSR_ROUTER__?.navigate)"));
    await evaluate(probe + "('dismissOnboarding')");

    const navigate = async (id) => {
      const to = "/" + environment + "/" + id;
      await evaluate("window.__TSR_ROUTER__.navigate({to:" + JSON.stringify(to) + "}).then(()=>true)");
      await wait(
        "rendered " + id,
        () => evaluate(`Array.from(document.querySelectorAll('[data-timeline-root]')).some(e => e.textContent.includes(${JSON.stringify("MARK_" + id + "_")}))`),
        15000,
      );
      await evaluate("new Promise(r => requestAnimationFrame(() => r(true)))");
    };

    const readRendererState = async (withGc) => {
      if (withGc) {
        await page("HeapProfiler.collectGarbage");
        await sleep(150);
        await page("HeapProfiler.collectGarbage");
        await sleep(150);
      }
      const usage = await page("Runtime.getHeapUsage");
      const dom = await page("Memory.getDOMCounters");
      const proc = sampleTree(app.pid, state.pid);
      return {
        heapUsedMiB: Number((usage.usedSize / 1048576).toFixed(3)),
        heapTotalMiB: Number((usage.totalSize / 1048576).toFixed(3)),
        embedderMiB: Number(((usage.embedderHeapUsedSize ?? 0) / 1048576).toFixed(3)),
        dom,
        processMemory: proc,
      };
    };

    // Phase A: 1 open thread
    await navigate(targets[0]);
    await sleep(3000);
    const oneThreadBeforeGc = await readRendererState(false);
    const oneThreadAfterGc = await readRendererState(true);

    // Phase B: 50 consecutive thread switches across 10 seeded threads
    const before50 = oneThreadAfterGc;
    for (let i = 1; i <= 50; i++) {
      await navigate(targets[i % targets.length]);
    }
    const after50BeforeGc = await readRendererState(false);
    const after50 = await readRendererState(true);
    const switchLeak = {
      switches: 50,
      distinctThreads: targets.length,
      before: before50,
      afterBeforeGc: after50BeforeGc,
      after: after50,
      delta: {
        heapUsedMiB: Number((after50.heapUsedMiB - before50.heapUsedMiB).toFixed(3)),
        heapTotalMiB: Number((after50.heapTotalMiB - before50.heapTotalMiB).toFixed(3)),
        domNodes: after50.dom.nodes - before50.dom.nodes,
        jsEventListeners: after50.dom.jsEventListeners - before50.dom.jsEventListeners,
        rendererPrivateMiB: Number((after50.processMemory.renderer.privateMiB - before50.processMemory.renderer.privateMiB).toFixed(3)),
        serverPrivateMiB: Number((after50.processMemory.server.privateMiB - before50.processMemory.server.privateMiB).toFixed(3)),
        totalPrivateMiB: Number((after50.processMemory.total.privateMiB - before50.processMemory.total.privateMiB).toFixed(3)),
      },
    };

    // Phase C: Minimize & wait 15s (without forcing CDP GC)
    const beforeMinimize = await readRendererState(false);
    let minimize;
    try {
      const minState = controlWindow(app.pid, 6); // SW_MINIMIZE
      assert(minState.iconic, "Window did not minimize");
      await sleep(15000);
      const minimizedVisibility = await evaluate("document.visibilityState");
      const afterMinimize = await readRendererState(false);
      const restoreState = controlWindow(app.pid, 9, minState.hwnd); // SW_RESTORE
      assert(!restoreState.iconic, "Window did not restore");
      await sleep(1000);
      const restoredOk = await evaluate("document.querySelectorAll('[data-timeline-root]').length > 0");
      assert(restoredOk, "Window did not restore cleanly after minimize");
      minimize = {
        ok: true,
        before: beforeMinimize,
        after: afterMinimize,
        minimizedVisibility,
        restoredOk,
        delta: {
          rendererPrivateMiB: Number((afterMinimize.processMemory.renderer.privateMiB - beforeMinimize.processMemory.renderer.privateMiB).toFixed(3)),
          gpuPrivateMiB: Number((afterMinimize.processMemory.gpu.privateMiB - beforeMinimize.processMemory.gpu.privateMiB).toFixed(3)),
          totalPrivateMiB: Number((afterMinimize.processMemory.total.privateMiB - beforeMinimize.processMemory.total.privateMiB).toFixed(3)),
          heapUsedMiB: Number((afterMinimize.heapUsedMiB - beforeMinimize.heapUsedMiB).toFixed(3)),
        },
      };
    } catch (error) {
      minimize = { ok: false, error: error instanceof Error ? error.message : String(error), before: beforeMinimize };
    }

    return {
      oneThread: oneThreadBeforeGc,
      oneThreadAfterGc,
      switchLeak,
      minimize,
      sqlite: sqliteStats(userdata),
    };
  } finally {
    rpc?.close();
    cdp?.close();
    if (app && app.exitCode === null) {
      try { execFileSync("taskkill.exe", ["/pid", String(app.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" }); } catch {}
    }
    sb.close();
  }
}

const serverDiag = await runServerDiag();
const acpMcpBridge = await runAcpMcpBridgeDiag();
const desktopAudit = await runDesktopAudit();
const result = { serverDiag, acpMcpBridge, ...desktopAudit };
writeFileSync(resolve(output), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({
  serverDiag,
  acpMcpBridge,
  oneThreadTotalPrivateMiB: desktopAudit.oneThread.processMemory.total.privateMiB,
  switchDelta: desktopAudit.switchLeak.delta,
  minimizeDelta: desktopAudit.minimize.delta ?? desktopAudit.minimize.error,
}, null, 2));
assert(desktopAudit.minimize.ok, "Minimize check failed: " + desktopAudit.minimize.error);

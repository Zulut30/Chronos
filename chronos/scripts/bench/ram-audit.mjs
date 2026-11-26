// Focused Windows RAM diagnostic: server isolate/worker breakdown, 1-thread memory,
// 50 thread switches heap/DOM leak check, and minimize memory release check.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
'
$h = [IntPtr]${existingHwnd}
if ($h -eq [IntPtr]::Zero) {
  $p = Get-Process -Id ${pid} -ErrorAction Stop
  $p.Refresh()
  $h = $p.MainWindowHandle
}
if ($h -eq [IntPtr]::Zero) { throw "No MainWindowHandle for PID ${pid}" }
[void][Win32.Native]::ShowWindow($h, ${cmd})
Start-Sleep -Milliseconds 300
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

async function runDesktopAudit() {
  const sb = createSandbox(20, 40, "code");
  const { port, run, start, wait, env, userdata, work, profile, modelSelection } = sb;
  const nodeEnv = { ...env, ELECTRON_RUN_AS_NODE: "1" };
  const listen = await port();
  const debug = await port();
  const origin = "http://127.0.0.1:" + listen;
  const proj = crypto.randomUUID();
  const targets = Array.from({ length: 10 }, () => crypto.randomUUID());
  let rpc, cdp;
  try {
    const app = start(
      exe,
      ["--remote-debugging-port=" + debug, "--user-data-dir=" + profile],
      { ...env, T3CODE_PORT: String(listen) },
    );
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

    const minimize = {
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
    sb.close();
  }
}

const serverDiag = await runServerDiag();
const desktopAudit = await runDesktopAudit();
const result = { serverDiag, ...desktopAudit };
writeFileSync(resolve(output), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({
  serverDiag,
  oneThreadTotalPrivateMiB: desktopAudit.oneThread.processMemory.total.privateMiB,
  switchDelta: desktopAudit.switchLeak.delta,
  minimizeDelta: desktopAudit.minimize.delta,
}, null, 2));

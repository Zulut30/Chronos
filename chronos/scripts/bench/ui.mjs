import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createSandbox } from "./sandbox.mjs";
import { connectCdp, rpcClient } from "./client.mjs";
import { measureUi } from "./ui-metrics.mjs";

const [mode, distribution, count, output, action] = process.argv.slice(2);
const n = Number(count),
  frames = 480,
  interval = 85;
assert(["web", "desktop"].includes(mode) && [0, 8, 16].includes(n) && output);
if (mode === "desktop")
  assert.equal(
    process.env.RUNNER_ENVIRONMENT,
    "github-hosted",
    "Fixed service ports require a disposable VM",
  );
const rows = Number(process.env.BENCH_UI_ROWS ?? 300);
assert(Number.isSafeInteger(rows) && rows >= 300 && rows <= 1000);
const exe = resolve(distribution, "Chronos.exe");
const entry = resolve(distribution, "resources/server.asar/apps/server/dist/bin.mjs");
const sb = createSandbox(frames, interval, "code");
const { port, run, start, wait, env, root, home, userdata, work, profile, modelSelection } = sb;
const nodeEnv = { ...env, ELECTRON_RUN_AS_NODE: "1" };
const listen = await port(),
  debug = await port(),
  origin = "http://127.0.0.1:" + listen;
const proj = crypto.randomUUID();
const targets = [crypto.randomUUID(), crypto.randomUUID()];
const ids = Array.from({ length: n }, () => crypto.randomUUID());
const stateFile = join(userdata, "server-runtime.json");
let rpc, cdp, evaluate;
async function benchmark() {
  let server, app;
  const launched = Date.now();
  if (mode === "desktop") {
    app = start(
      exe,
      [
        "--remote-debugging-port=" + debug,
        "--user-data-dir=" + profile,
        "--disable-renderer-backgrounding",
        "--disable-background-timer-throttling",
      ],
      { ...env, T3CODE_PORT: String(listen) },
    );
  } else {
    server = start(
      exe,
      [entry, "serve", "--base-dir", home, "--port", String(listen), "--host", "127.0.0.1", "--no-browser"],
      nodeEnv,
    );
    start(
      process.env.BENCH_CHROME ?? join(process.env.ProgramFiles, "Google/Chrome/Application/chrome.exe"),
      [
        "--headless",
        "--window-size=1400,900",
        "--remote-debugging-port=" + debug,
        "--user-data-dir=" + profile,
        "--no-first-run",
        "--disable-extensions",
        "--disable-background-networking",
        "--renderer-process-limit=1",
        "--disable-features=SpareRendererForSitePerProcess",
        "--proxy-server=127.0.0.1:9",
        "--proxy-bypass-list=<-loopback>;127.0.0.1:" + listen,
        "about:blank",
      ],
      env,
    );
  }
  const state = await wait(
    "private server",
    () => existsSync(stateFile) && JSON.parse(readFileSync(stateFile, "utf8")),
  );
  assert.equal(state.origin, origin);
  if (server) assert.equal(state.pid, server.pid);
  const getCdp = async (path) => (await fetch("http://127.0.0.1:" + debug + path)).json();
  const endpoint = await wait("CDP", () => getCdp("/json/version").catch(() => false));
  cdp = await connectCdp(endpoint.webSocketDebuggerUrl);
  const target = await wait("Chronos page", async () =>
    (await getCdp("/json/list")).find(
      (t) => t.type === "page" && (mode === "web" || t.url.startsWith("t3code://app")),
    ),
  );
  const { sessionId } = await cdp.call("Target.attachToTarget", { targetId: target.id, flatten: true });
  const page = (method, params) => cdp.call(method, params, sessionId);
  evaluate = async (expression) => {
    const r = await page("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  await page("Emulation.setDeviceMetricsOverride", {
    width: 1400,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page("Page.bringToFront");
  if (action === "startup") {
    assert.equal(mode, "desktop");
    const surface = await wait("interactive startup surface", () => evaluate(`(() => {
      if (!window.__TSR_ROUTER__ || !performance.getEntriesByName("first-contentful-paint").length) return false;
      if (document.querySelector("[data-slot=composer-host] [contenteditable=true]")) return "composer";
      const route = window.__TSR_ROUTER__.state.location.pathname;
      const buttons = [...document.querySelectorAll("button")].filter(b => !b.disabled && b.getClientRects().length);
      if (route === "/welcome" && buttons.some(b => /^(Начать|Запустить|Start|Пропустить|Skip)( |$)/i.test(b.innerText.trim()))) return "welcome";
      if (buttons.some(b => /^(Добавить проект|Add project)$/i.test(b.innerText.trim()))) return "project";
      return false;
    })()`));
    const startup = await evaluate(`new Promise(resolve => requestAnimationFrame(() => {
      const paint = performance.getEntriesByName("first-contentful-paint")[0];
      const scripts = performance.getEntriesByType("resource").filter(r => /\\.m?js($|[?#])/.test(r.name));
      resolve({ route: window.__TSR_ROUTER__.state.location.pathname,
        readyAt: performance.timeOrigin + performance.now(),
        paintedAt: paint && performance.timeOrigin + paint.startTime,
        scripts: scripts.map(r => ({ name: new URL(r.name).pathname.split("/").pop(), bytes: r.decodedBodySize })) });
    }))`);
    const result = { route: startup.route, surface, firstPaintMs: startup.paintedAt - launched,
      readyMs: startup.readyAt - launched, scripts: startup.scripts };
    assert(result.firstPaintMs > 0 && result.readyMs >= result.firstPaintMs);
    writeFileSync(output, JSON.stringify(result, null, 2));
    return;
  }
  await page("Performance.enable");
  await page("Network.enable");
  const detailIds = new Set();
  cdp.listen((event) => {
    if (event.sessionId !== sessionId || event.method !== "Network.webSocketFrameSent") return;
    try {
      const data = JSON.parse(event.params.response.payloadData);
      for (const m of [data].flat())
        if (m.tag === "orchestration.subscribeThread") detailIds.add(m.payload.threadId);
    } catch {
      /* Non-RPC socket */
    }
  });
  async function post(path, body, token) {
    const r = await fetch(origin + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: "Bearer " + token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert(r.ok, path + " " + r.status);
    return r;
  }
  const bearer = run(
    exe,
    [entry, "auth", "session", "issue", "--token-only", "--label", "ui-bench"],
    nodeEnv,
  ).trim();
  if (mode === "web") {
    await page("Network.setBlockedURLs", {
      urls: Array.from({ length: 8 }, (_, i) => "*:" + (4517 + i) + "/*"),
    });
    const { credential } = JSON.parse(run(exe, [entry, "auth", "pairing", "create", "--json"], nodeEnv));
    const cookies = (await post("/api/auth/browser-session", { credential })).headers.getSetCookie();
    for (const cookie of cookies) {
      const [pair] = cookie.split(";"),
        ix = pair.indexOf("=");
      if (pair.slice(ix + 1))
        await page("Network.setCookie", {
          name: pair.slice(0, ix),
          value: pair.slice(ix + 1),
          url: origin,
        });
    }
  }
  await post(
    "/api/projects/mutate",
    {
      type: "project.create",
      commandId: crypto.randomUUID(),
      projectId: proj,
      title: "Bench",
      workspaceRoot: work,
    },
    bearer,
  );
  const { ticket } = await (await post("/api/auth/websocket-ticket/rpc", null, bearer)).json();
  rpc = await rpcClient(
    origin.replace("http:", "ws:") + "/ws?orchestrationProtocol=2&wsTicket=" + encodeURIComponent(ticket),
  );
  const environment = (await (await fetch(origin + "/.well-known/t3/environment")).json()).environmentId;
  const common = {
    projectId: proj,
    modelSelection,
    runtimeMode: "approval-required",
    interactionMode: "default",
  };
  console.log("Seeding", mode, n);
  for (let i = 0; i < rows; i += 8) {
    await Promise.all(
      Array.from({ length: Math.min(8, rows - i) }, (_, j) =>
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
  const launch = (id, seed, prefix = "") =>
    rpc.call("orchestration.launchThread", {
      ...common,
      commandId: crypto.randomUUID(),
      threadId: id,
      title: "Bench " + id,
      generateTitle: false,
      workspaceStrategy: { type: "root" },
      initialMessage: { text: prefix + (seed ? "SEED_HISTORY " : "") + "bench-" + id, attachments: [] },
    });
  const projection = (id) => rpc.call("orchestration.getThreadProjection", { threadId: id });
  const finished = async (id) => (await projection(id)).runs.at(-1)?.status === "completed";
  await Promise.all(targets.map((id) => launch(id, true)));
  await wait("seeded histories", async () => (await Promise.all(targets.map(finished))).every(Boolean));
  const route = (id) => "/" + environment + "/" + id;
  if (mode === "web") await page("Page.navigate", { url: origin + route(targets[1]) });
  const probe = readFileSync(join(import.meta.dirname, "../smoke/page-probes.js"), "utf8")
    .trim()
    .replace(/;$/, "");
  const navigate = async (id) => {
    await evaluate("window.__TSR_ROUTER__.navigate({to:" + JSON.stringify(route(id)) + "}).then(()=>true)");
  };
  await wait("router", () => evaluate("Boolean(window.__TSR_ROUTER__?.navigate)"));
  await evaluate(probe + "('dismissOnboarding')");
  await navigate(targets[1]);
  await wait("expanded rows", async () =>
    evaluate(`(() => {
    for (const b of document.querySelectorAll('[data-testid=sidebar-project-folder] button[aria-expanded=false]')) b.click();
    return document.querySelectorAll('[data-thread-item]').length >= ${rows};
  })()`),
  );
  if (action === "smoke") {
    assert.equal(mode, "desktop");
    const { runFullSmoke } = await import("./desktop-smoke.mjs");
    await runFullSmoke(debug, output, env);
  } else {
    await Promise.all(ids.map((id, index) => launch(id, false, "SPEED_TOKENS_" + (501 + index) + " ")));
    await wait("agent start barrier", () => ids.every((id) => existsSync(join(root, id + ".ready"))));
    const rowCount = await evaluate("document.querySelectorAll('[data-thread-item]').length");
    const perf = async () =>
      Object.fromEntries((await page("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
    const before = await perf();
    let traced;
    const traceDone = new Promise((resolve) => {
      traced = resolve;
    });
    if (process.env.BENCH_UI_TRACE) {
      cdp.listen((e) => {
        if (e.method === "Tracing.tracingComplete") traced(e.params.stream);
      });
      await cdp.call("Tracing.start", {
        categories: "devtools.timeline,blink.user_timing,cc,viz,input,latencyInfo",
        transferMode: "ReturnAsStream",
        streamCompression: "gzip",
      });
    }
    const deliveries = [];
    if (n && process.env.BENCH_UI_CADENCE) {
      let synchronized = false,
        previous = "";
      rpc.stream(
        "orchestration.subscribeThread",
        { threadId: ids[0], requestCompletionMarker: true, acceptBoundedSnapshot: true },
        (item) => {
          if (item.kind === "synchronized") synchronized = true;
          if (item.kind !== "event" || item.event.type !== "turn-item.updated") return;
          const value = item.event.payload;
          if (
            value.type !== "assistant_message" ||
            !value.streaming ||
            value.text.length < 4096 ||
            value.text === previous
          )
            return;
          previous = value.text;
          deliveries.push(performance.now());
        },
      );
      await wait("cadence subscription", () => {
        rpc.check();
        return synchronized;
      });
    }
    console.log("UI sample", mode, n, rowCount);
    writeFileSync(join(root, "go"), "");
    if (n)
      await wait("first streamed marker", async () =>
        (await projection(ids[0])).turnItems.some(
          (i) => i.type === "assistant_message" && i.text?.includes("MARK_"),
        ),
      );
    const sample = await measureUi({
      page,
      evaluate,
      targets,
      streamingId: ids[0],
      navigate,
      wait,
      verifyStreaming: () =>
        assert(
          ids.every((id) => !existsSync(join(root, id + ".txt"))),
          "Stream finished before input samples",
        ),
    });
    const after = await perf();
    if (process.env.BENCH_UI_TRACE) {
      await cdp.call("Tracing.end");
      const handle = await Promise.race([
        traceDone,
        sleep(15000).then(() => {
          throw Error("Missing trace completion");
        }),
      ]);
      const file = createWriteStream(output + ".trace.json.gz");
      for (;;) {
        const chunk = await cdp.call("IO.read", { handle, size: 1048576 });
        if (!file.write(Buffer.from(chunk.data, chunk.base64Encoded ? "base64" : "utf8")))
          await once(file, "drain");
        if (chunk.eof) break;
      }
      file.end();
      await once(file, "close");
      await cdp.call("IO.close", { handle });
    }
    const pids = (await cdp.call("SystemInfo.getProcessInfo")).processInfo
      .filter((p) => p.type.toLowerCase() === "renderer")
      .map((p) => Number(p.id));
    assert(pids.length && pids.every(Number.isSafeInteger));
    const rss = Number(
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          "(Get-Process -Id " + pids.join(",") + " | Measure-Object WorkingSet64 -Sum).Sum",
        ],
        { windowsHide: true, encoding: "utf8" },
      ),
    );
    assert(rss > 0);
    let processMemory;
    if (mode === "desktop" && app?.pid) {
      try {
        processMemory = JSON.parse(
          execFileSync(
            "pwsh",
            [
              "-NoProfile",
              "-File",
              join(import.meta.dirname, "tree-memory.ps1"),
              "-RootPid",
              String(app.pid),
              "-ServerPid",
              String(state.pid),
            ],
            { windowsHide: true, encoding: "utf8", timeout: 30000 },
          ),
        );
      } catch {
        /* Diagnostic process-tree breakdown must not fail UI verification */
      }
    }
    let domCounters;
    try {
      domCounters = await page("Memory.getDOMCounters");
    } catch {}
    let concurrentApproval;
    if (n && mode === "desktop") {
      const busy = ids.filter((id) => !existsSync(join(root, id + ".txt"))).length;
      if (rows === 1000) assert.equal(busy, n, "Large-sidebar RSS requires all agents still streaming");
      assert(busy >= 4, "Need at least four busy background agents for the approval check");
      const { verifyApproval } = await import("./ui-history.mjs");
      concurrentApproval = { busy, ...(await verifyApproval({ rpc, evaluate, wait, launch })) };
      await navigate(ids[0]);
    }
    await wait(
      "all mocks finished writing",
      () => ids.every((id) => existsSync(join(root, id + ".txt"))),
      100000,
    );
    await wait(
      "all runs complete",
      async () => (await Promise.all(ids.map(finished))).every(Boolean),
      100000,
    );
    for (const id of [...targets, ...ids]) {
      const text = (await projection(id)).turnItems
        .filter((i) => i.type === "assistant_message")
        .map((i) => i.text)
        .join("")
        .trim();
      assert.equal(text, readFileSync(join(root, id + ".txt"), "utf8").trim());
    }
    if (n)
      await wait("final visible marker", () =>
        evaluate("uiBench.hasText(" + JSON.stringify("MARK_" + ids[0] + "_" + (frames - 1) + "_") + ")"),
      );
    const readOlympus = () =>
      evaluate(`(() => {
      const ids = ${JSON.stringify(ids)};
      const speed = globalThis.__olySpeed;
      const turns = Array.from(speed.turns.values());
      return {
        speedObserved: { frames: speed.frames, parsed: speed.parsed, turns: turns.length, items: speed.items.size, rateThreads: speed.textPts.size, error: speed.err ?? null },
        liveSpeedPoints: ids.filter(id => (globalThis.__olySpeed.textPts.get(id)?.length ?? 0) > 1).length,
        budgets: ids.map(id => globalThis.__olyBudget.total(id,${JSON.stringify(environment)})),
        speedSamples: ids.filter((_, index) => Object.values(speed.S.m.bench?.x ?? {}).some(bucket => bucket.t.some(([tokens, ms]) => tokens === 501 + index && ms > 1500))).length,
        speedTurns: ids.filter((id, index) => turns.some(t => t.thread === id && t.status === "completed" && t.usage?.outputTokens === 501 + index)).length,
      };
    })()`);
    let olympus = await readOlympus();
    if (mode === "desktop" && n) {
      // The server may finalize before Electron receives its last WebSocket chunk.
      const until = Date.now() + 5000;
      while (
        Date.now() < until &&
        (olympus.budgets.some((cost) => cost !== 0.42) || olympus.speedSamples < n || olympus.speedTurns < n)
      ) {
        await sleep(100);
        olympus = await readOlympus();
      }
    }
    const placeholders = await evaluate(
      "document.querySelectorAll('[data-sidebar-card-placeholder]').length",
    );
    // Verify the offscreen row remains reachable using the same DOM contract as Olympus.
    const farId = await evaluate("uiBench.revealOffscreenCard()");
    try {
      await wait("offscreen card", () => evaluate("uiBench.advanceToOffscreenCard()"));
    } catch (error) {
      console.error("Offscreen card at failure", farId, await evaluate("uiBench.offscreenState()"));
      throw error;
    }
    const offscreenCard = await evaluate("uiBench.offscreenState()");
    assert(await evaluate("uiBench.focusRevealedCard()"), "Revealed card did not receive keyboard focus");
    await page("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
    await page("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
    await wait("offscreen activation", () =>
      evaluate("location.href.includes(" + JSON.stringify(farId) + ")"),
    );
    const settingsMs = [];
    for (let i = 0; i < 3; i++) {
      settingsMs.push(await evaluate("uiBench.openSettings()"));
      await navigate(targets[0]);
      await wait("history after settings", () =>
        evaluate("uiBench.hasText(" + JSON.stringify("MARK_" + targets[0] + "_11_") + ")"),
      );
    }
    let history;
    if (n === 0 && rows === 300) {
      const { verifyHistoryAndApproval } = await import("./ui-history.mjs");
      history = await verifyHistoryAndApproval({ rpc, evaluate, navigate, wait, targets, launch });
    }
    const gaps = deliveries.slice(1).map((t, i) => t - deliveries[i]);
    const cadence = gaps.length
      ? {
          samples: deliveries.length,
          minGapMs: Math.min(...gaps),
          medianGapMs: gaps.toSorted((a, b) => a - b)[Math.floor(gaps.length / 2)],
          below125ms: gaps.filter((t) => t < 125).length,
        }
      : null;
    let tooltipVerified;
    if (rows === 1000 && n === 16) {
      const selector = '[data-thread-item$="' + targets[1] + '"] [data-sidebar-row]';
      await page("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: "center", behavior: "instant" })`);
      const point = await wait("visible hover target", () => evaluate(`(() => {
        const row = document.querySelector(${JSON.stringify(selector)});
        const box = row.getBoundingClientRect();
        const x = box.left + 12, y = box.top + box.height / 2;
        return row.contains(document.elementFromPoint(x, y)) && { x, y };
      })()`));
      await page("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
      await wait("thread details after revealing its row", () => evaluate(`
        [...document.querySelectorAll("[data-slot=tooltip-popup]")].some(popup =>
          popup.getClientRects().length && popup.textContent.includes(${JSON.stringify("Bench " + targets[1])}))
      `), 6000);
      tooltipVerified = true;
    }
    const result = {
      mode,
      n,
      rowCount,
      frames,
      interval,
      olympus,
      placeholders,
      offscreenCard,
      settingsMs,
      history,
      cadence,
      concurrentApproval,
      tooltipVerified,
      rendererCount: pids.length,
      rendererRssMiB: rss / 1048576,
      ...(processMemory ? { processMemory } : {}),
      ...(domCounters ? { domCounters } : {}),
      heapMiB: after.JSHeapUsedSize / 1048576,
      layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
      scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
      rendererAgentSubscriptions: ids.filter((id) => detailIds.has(id)).length,
      verifiedHistories: n + 2,
      ...sample,
    };
    writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
    console.log(result);
    if (mode === "desktop") {
      assert.deepEqual(
        olympus.budgets,
        ids.map(() => 0.42),
        "Olympus lost a completed agent cost",
      );
      assert.equal(olympus.speedTurns, n, "Olympus lost final per-turn token usage");
      assert.equal(olympus.speedSamples, n, "Olympus lost a model throughput sample");
    }
  }
}
try {
  await benchmark();
} catch (error) {
  if (evaluate)
    console.error(
      "UI at failure:",
      await evaluate(
        "JSON.stringify({route:location.pathname,hash:location.hash, rows:document.querySelectorAll('[data-thread-item]').length,text:document.body.innerText.slice(-1600)})",
      ).catch(() => null),
    );
  throw error;
} finally {
  rpc?.close();
  cdp?.close();
  sb.close();
}

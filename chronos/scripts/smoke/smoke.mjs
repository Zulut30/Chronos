#!/usr/bin/env node
// Automated CDP smoke suite for Chronos (zero npm dependencies, Node 24+).
//
// Usage:
//   node chronos/scripts/smoke/smoke.mjs --out <dir> [--port 9333]
//   node chronos/scripts/smoke/smoke.mjs --launch <Chronos.exe> --out <dir> [--allow-offline-services] [--no-screenshots]
//
// See chronos/scripts/smoke/README.md for full documentation.

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROBE_SRC = readFileSync(join(SCRIPT_DIR, "page-probes.js"), "utf8")
  .trim()
  .replace(/;+\s*$/, "");

function printUsage() {
  console.log(`Usage: node chronos/scripts/smoke/smoke.mjs [options]

Options:
  --port <number>            CDP port (default: 9333)
  --launch <path>            Launch Chronos executable with --remote-debugging-port=<port>
  --launch-timeout <ms>      Max wait for Chronos startup (default: 90000)
  --extra-arg <arg>          Extra CLI argument passed when using --launch (repeatable)
  --keep-open                Keep launched Chronos running after smoke completes
  --out <dir>                Output directory for report.json and screenshots
                             (default: <os.tmpdir>/chronos-smoke-<timestamp>)
  --checks <file>            Path to checks.json (default: sibling checks.json)
  --only <id1,id2>           Run only the specified screen IDs
  --no-screenshots           Skip writing PNG screenshots (functional checks only)
  --allow-offline-services   Ignore connection-refused errors to local Olympus ports 4517-4524
                             and accept offline fallback UI on service-backed screens
  --profile <full|clean>     Clean skips provider-dependent checks (default: full)
  --strict-en                Fail if unexpected English phrases are detected
  -h, --help                 Show this help message`);
}

function parseArgs(argv) {
  const opts = {
    port: 9333,
    launch: null,
    launchTimeoutMs: 90_000,
    extraArgs: [],
    keepOpen: false,
    outDir: null,
    checksPath: join(SCRIPT_DIR, "checks.json"),
    only: null,
    screenshots: true,
    allowOfflineServices: false,
    strictEn: false,
    profile: "full",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      printUsage();
      process.exit(0);
    } else if (arg === "--port") {
      opts.port = Number(argv[++i]);
      if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) {
        throw new Error(`Invalid --port value: ${argv[i]}`);
      }
    } else if (arg === "--launch") {
      opts.launch = argv[++i];
      if (!opts.launch) throw new Error("--launch requires a path to Chronos.exe");
    } else if (arg === "--launch-timeout") {
      opts.launchTimeoutMs = Number(argv[++i]);
      if (!Number.isFinite(opts.launchTimeoutMs) || opts.launchTimeoutMs < 1000) {
        throw new Error(`Invalid --launch-timeout value: ${argv[i]}`);
      }
    } else if (arg === "--extra-arg") {
      const v = argv[++i];
      if (!v) throw new Error("--extra-arg requires a value");
      opts.extraArgs.push(v);
    } else if (arg === "--keep-open") {
      opts.keepOpen = true;
    } else if (arg === "--out") {
      opts.outDir = argv[++i];
      if (!opts.outDir) throw new Error("--out requires a directory path");
    } else if (arg === "--checks") {
      opts.checksPath = argv[++i];
      if (!opts.checksPath) throw new Error("--checks requires a file path");
    } else if (arg === "--only") {
      const raw = argv[++i];
      if (!raw) throw new Error("--only requires comma-separated screen IDs");
      opts.only = new Set(
        raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
    } else if (arg === "--no-screenshots") {
      opts.screenshots = false;
    } else if (arg === "--allow-offline-services") {
      opts.allowOfflineServices = true;
    } else if (arg === "--profile") {
      opts.profile = argv[++i];
      if (!["full", "clean"].includes(opts.profile)) throw new Error("Expected --profile full or clean");
    } else if (arg === "--strict-en") {
      opts.strictEn = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!opts.outDir) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    opts.outDir = join(tmpdir(), `chronos-smoke-${stamp}`);
  }
  opts.outDir = resolve(opts.outDir);
  opts.checksPath = resolve(opts.checksPath);
  return opts;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, timeoutMs = 4000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function waitForPageTarget(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "CDP endpoint did not respond";
  while (Date.now() < deadline) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json`, 2500);
      const page = targets.find(
        (t) =>
          t.type === "page" &&
          typeof t.url === "string" &&
          t.url.startsWith("t3code://") &&
          typeof t.webSocketDebuggerUrl === "string",
      );
      if (page) return page;
      lastError = `Waiting for t3code:// page (saw ${targets.length} target(s): ${targets.map((t) => `${t.type}:${t.url}`).join(", ")})`;
    } catch (err) {
      lastError = String(err?.message || err);
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for Chronos CDP page on port ${port}: ${lastError}`);
}

function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Ignore already exited.
    }
  }
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 0;
    this.pending = new Map();
    this.events = [];
  }

  async connect(timeoutMs = 15_000) {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolveOpen, rejectOpen) => {
      const timer = setTimeout(() => rejectOpen(new Error("WebSocket connect timeout")), timeoutMs);
      this.ws.onopen = () => {
        clearTimeout(timer);
        resolveOpen();
      };
      this.ws.onerror = (err) => {
        clearTimeout(timer);
        rejectOpen(new Error(`WebSocket error: ${err?.message || "connection failed"}`));
      };
    });

    this.ws.onmessage = (m) => {
      let msg;
      try {
        msg = JSON.parse(m.data);
      } catch {
        return;
      }
      if (msg.id && this.pending.has(msg.id)) {
        const entry = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        clearTimeout(entry.timer);
        if (msg.error) {
          entry.reject(new Error(`CDP ${entry.method} error: ${msg.error.message || JSON.stringify(msg.error)}`));
        } else {
          entry.resolve(msg.result ?? {});
        }
      } else if (msg.method) {
        this.events.push(msg);
      }
    };

    this.ws.onclose = () => {
      for (const [, entry] of this.pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error("CDP WebSocket closed unexpectedly"));
      }
      this.pending.clear();
    };
  }

  send(method, params = {}, timeoutMs = 30_000) {
    const id = ++this.nextId;
    return new Promise((resolveSend, rejectSend) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectSend(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolveSend, reject: rejectSend, timer, method });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  clearEvents() {
    this.events = [];
  }

  async probe(action, arg = null, timeoutMs = 30_000) {
    const expression = `(${PROBE_SRC})(${JSON.stringify(action)}, ${JSON.stringify(arg)})`;
    const res = await this.send(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true },
      timeoutMs,
    );
    if (res.exceptionDetails) {
      const desc =
        res.exceptionDetails.exception?.description ||
        res.exceptionDetails.text ||
        "Unknown Runtime.evaluate exception";
      throw new Error(`Page probe "${action}" threw: ${desc}`);
    }
    return res.result?.value;
  }

  // Pump compositor frames so requestAnimationFrame runs even when the Electron window is hidden/minimized.
  async pumpFrames(count = 2, gapMs = 200) {
    for (let i = 0; i < count; i += 1) {
      await this.send("Page.captureScreenshot", {
        format: "png",
        clip: { x: 0, y: 0, width: 16, height: 16, scale: 1 },
      });
      if (gapMs > 0) await sleep(gapMs);
    }
  }

  async close() {
    if (!this.ws) return;
    try {
      this.ws.close();
    } catch {
      // Ignore close error.
    }
    this.ws = null;
  }
}

function classifyEvents(events, localServicePorts, allowOfflineServices) {
  const portSet = new Set(localServicePorts || []);
  const errors = [];
  const ignoredNetworkErrors = [];

  const isLocalServiceUrl = (url) => {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") return false;
      return portSet.has(Number(parsed.port));
    } catch {
      return false;
    }
  };

  for (const e of events) {
    if (e.method === "Runtime.exceptionThrown") {
      const details = e.params?.exceptionDetails || {};
      const text = (details.exception?.description || details.text || "Uncaught exception").slice(0, 500);
      errors.push({ kind: "exception", text });
    } else if (e.method === "Runtime.consoleAPICalled" && e.params?.type === "error") {
      const text = (e.params.args || [])
        .map((a) => (typeof a.value === "string" ? a.value : a.description ?? JSON.stringify(a.value ?? "")))
        .join(" ")
        .slice(0, 500);
      errors.push({ kind: "console.error", text });
    } else if (e.method === "Log.entryAdded" && e.params?.entry?.level === "error") {
      const entry = e.params.entry;
      const text = String(entry.text || "").slice(0, 500);
      const url = entry.url || "";
      const isOfflineSvc =
        allowOfflineServices &&
        entry.source === "network" &&
        isLocalServiceUrl(url) &&
        /ERR_CONNECTION_REFUSED/i.test(text);
      if (isOfflineSvc) {
        ignoredNetworkErrors.push({ kind: "log.network", text, url });
      } else {
        errors.push({ kind: "log.error", text, url: url || undefined });
      }
    }
  }

  return { errors, ignoredNetworkErrors };
}

async function waitUntilReady(client, waitFor, defaultTimeoutMs = 8000) {
  if (!waitFor) return { ready: true, detail: "no wait condition" };
  const timeoutMs = waitFor.timeoutMs ?? defaultTimeoutMs;
  const deadline = Date.now() + timeoutMs;
  let last = { ready: false, detail: "not checked yet" };
  while (Date.now() < deadline) {
    await client.pumpFrames(1, 150);
    last = await client.probe("checkReady", waitFor);
    if (last.ready) return last;
    await sleep(200);
  }
  return last;
}

async function settleScreen(client, settleMs = 600) {
  const pumps = Math.max(2, Math.ceil(settleMs / 350));
  const gap = Math.max(150, Math.round(settleMs / pumps));
  await client.pumpFrames(pumps, gap);
}

async function waitForAppHydrated(client, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    await client.pumpFrames(1, 200);
    last = await client.probe("appInfo");
    if (last?.hasRouter && last?.hasOlyCore && last?.bodyTextLength > 0) {
      return last;
    }
    await sleep(400);
  }
  throw new Error(`Chronos page did not hydrate within ${timeoutMs}ms: ${JSON.stringify(last)}`);
}

async function maybeDismissOnboarding(client) {
  const info = await client.probe("appInfo");
  if (info.pathname !== "/welcome") return { dismissed: false };
  const res = await client.probe("dismissOnboarding");
  if (!res?.clicked) {
    return { dismissed: false, detail: res };
  }
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await client.pumpFrames(1, 250);
    const cur = await client.probe("appInfo");
    if (cur.pathname && cur.pathname !== "/welcome") {
      return { dismissed: true, clickedText: res.clickedText, landedOn: cur.pathname };
    }
  }
  return { dismissed: false, detail: "Still on /welcome after clicking skip button" };
}

function extractVersionFromUserAgent(ua) {
  if (!ua) return null;
  const m = /Chronos(?:Nightly)?\/([^\s]+)/i.exec(ua);
  return m ? m[1] : null;
}

async function run() {
  const opts = parseArgs(process.argv.slice(2));
  const checks = JSON.parse(readFileSync(opts.checksPath, "utf8"));
  function skipReason(requires) {
    if (requires === "provider" && opts.profile === "clean") return "No agent provider assumed in clean profile";
    if (requires === "services" && opts.allowOfflineServices) return "Local Olympus services optional (--allow-offline-services)";
    return null;
  }
  mkdirSync(opts.outDir, { recursive: true });

  let launchedChild = null;
  if (opts.launch) {
    let alreadyOpen = false;
    try {
      await fetchJson(`http://127.0.0.1:${opts.port}/json`, 1000);
      alreadyOpen = true;
    } catch {
      // Expected: port is free.
    }
    if (alreadyOpen) {
      throw new Error(
        `CDP port ${opts.port} is already in use; omit --launch to attach to the running instance or pass a different --port`,
      );
    }
    const launchArgs = [`--remote-debugging-port=${opts.port}`, ...opts.extraArgs];
    launchedChild = spawn(opts.launch, launchArgs, {
      stdio: "ignore",
      windowsHide: false,
    });
    launchedChild.on("error", (err) => {
      console.error(`Failed to launch ${opts.launch}: ${err.message}`);
    });
  }

  let client = null;
  let initialTheme = null;
  const viewport = checks.viewport || { width: 1400, height: 900, deviceScaleFactor: 1 };

  try {
    const pageTarget = await waitForPageTarget(opts.port, opts.launch ? opts.launchTimeoutMs : 10_000);
    let cdpVersion = null;
    try {
      cdpVersion = await fetchJson(`http://127.0.0.1:${opts.port}/json/version`, 3000);
    } catch {
      // Optional metadata.
    }

    client = new CdpClient(pageTarget.webSocketDebuggerUrl);
    await client.connect();
    await client.send("Runtime.enable");
    await client.send("Log.enable");
    await client.send("Page.enable");
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor ?? 1,
      mobile: false,
    });
    if (checks.reducedMotion !== false) {
      await client.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "reduce" }],
      });
    }

    let appInfo = await waitForAppHydrated(client, opts.launch ? opts.launchTimeoutMs : 20_000);
    const onboarding = await maybeDismissOnboarding(client);
    if (onboarding.dismissed) {
      await settleScreen(client, 800);
      appInfo = await client.probe("appInfo");
    }

    initialTheme = await client.probe("getThemeState");
    const appVersion =
      appInfo.version || extractVersionFromUserAgent(cdpVersion?.["User-Agent"]) || "unknown";

    const report = {
      schemaVersion: 1,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      app: {
        version: appVersion,
        channel: appInfo.channel ?? null,
        arch: appInfo.appArch ?? null,
        branding: appInfo.branding ?? null,
        browser: cdpVersion?.Browser ?? null,
        userAgent: cdpVersion?.["User-Agent"] ?? null,
      },
      options: {
        port: opts.port,
        profile: opts.profile,
        launched: Boolean(opts.launch),
        screenshots: opts.screenshots,
        allowOfflineServices: opts.allowOfflineServices,
        strictEn: opts.strictEn,
        viewport,
        onboardingDismissed: onboarding.dismissed,
      },
      checks: {
        globals: null,
        scheme: null,
      },
      screens: [],
      summary: null,
      ok: false,
    };

    // 1. Check Olympus globals (28 expected).
    const globalsResult = await client.probe("checkGlobals", { expected: checks.globals || [] });
    report.checks.globals = globalsResult;

    // 2. Check t3code:// scheme privileges (/index.html + /assets/*.wasm).
    const schemeResult = await client.probe("checkScheme", checks.schemeChecks || {});
    report.checks.scheme = schemeResult;

    // 3. Visit each configured screen.
    const screens = (checks.screens || []).filter((s) => !opts.only || opts.only.has(s.id));
    for (const screen of screens) {
      const screenStart = Date.now();

      const screenReport = {
        id: screen.id,
        title: screen.title,
        ok: false,
        durationMs: 0,
        pathname: null,
        theme: null,
        skippedAssertions: [],
        screenshot: null,
        assertions: [],
        failedAssertions: [],
        errors: [],
        ignoredNetworkErrors: [],
        englishPhrases: [],
        unexpectedEnglishPhrases: [],
        dynamicMasks: [],
        extra: null,
      };

      const reason = skipReason(screen.requires);
      if (reason) {
        report.screens.push({ ...screenReport, ok: null, skipped: reason });
        console.log(`[SKIP] screen/${screen.id}: ${reason}`);
        continue;
      }
      const expect = [];
      for (const assertion of screen.expect || []) {
        const reason = skipReason(assertion.requires);
        if (reason) {
          screenReport.skippedAssertions.push({ label: assertion.label, reason });
          console.log(`[SKIP] screen/${screen.id} / ${assertion.label}: ${reason}`);
        } else {
          expect.push(assertion);
        }
      }
      if (opts.allowOfflineServices) expect.push(...(screen.expectOffline || []));
      const allowedEnglish = [...(screen.allowedEnglish || []),
        ...(opts.profile === "clean" ? screen.cleanAllowedEnglish || [] : [])];
      try {
        // Optional setup actions.
        if (Array.isArray(screen.setup)) {
          for (const step of screen.setup) {
            const actRes = await client.probe("performAction", step);
            if (!actRes.ok) throw new Error(`Setup failed: ${actRes.detail}`);
          }
          if (screen.setupWaitFor) {
            const setupReady = await waitUntilReady(client, screen.setupWaitFor);
            if (!setupReady.ready) {
              throw new Error(`Setup wait timed out: ${setupReady.detail}`);
            }
          } else {
            await settleScreen(client, 400);
          }
        }

        const mergedMaskSelectors = [
          ...(checks.globalMaskSelectors || []),
          ...(screen.maskSelectors || []),
        ];

        if (screen.action?.type === "toggleTheme") {
          const before = await client.probe("getThemeState");
          const clickRes1 = await client.probe("performAction", {
            type: "click",
            selector: screen.action.selector,
          });
          if (!clickRes1.ok) throw new Error(`First theme toggle click failed: ${clickRes1.detail}`);

          // Wait for theme flip.
          let toggled = before;
          const flipDeadline = Date.now() + 6000;
          while (Date.now() < flipDeadline) {
            await client.pumpFrames(1, 200);
            toggled = await client.probe("getThemeState");
            if (toggled.dark !== before.dark) break;
          }
          await settleScreen(client, screen.settleMs ?? 600);
          toggled = await client.probe("getThemeState");

          const inspected = await client.probe("inspectScreen", {
            expect,
            englishScan: checks.englishScan,
            cleanProfile: opts.profile === "clean",
            excludeEnglishSelectors: screen.excludeEnglishSelectors,
            allowedEnglish,
            maskSelectors: mergedMaskSelectors,
          });

          if (opts.screenshots) {
            if (checks.reducedMotion !== false) {
              await client.probe("freezeInfiniteAnimations");
              await client.pumpFrames(1, 100);
            }
            const shotRes = await client.send("Page.captureScreenshot", { format: "png" });
            const shotName = `${screen.id}.png`;
            writeFileSync(join(opts.outDir, shotName), Buffer.from(shotRes.data, "base64"));
            screenReport.screenshot = shotName;
          }

          // Toggle back to original theme.
          const clickRes2 = await client.probe("performAction", {
            type: "click",
            selector: screen.action.selector,
          });
          if (!clickRes2.ok) throw new Error(`Second theme toggle click failed: ${clickRes2.detail}`);

          let restored = toggled;
          const restoreDeadline = Date.now() + 6000;
          while (Date.now() < restoreDeadline) {
            await client.pumpFrames(1, 200);
            restored = await client.probe("getThemeState");
            if (restored.dark === before.dark) break;
          }
          await settleScreen(client, 400);
          restored = await client.probe("getThemeState");

          const flippedOk = toggled.dark !== before.dark && toggled.bg !== before.bg;
          const restoredOk = restored.dark === before.dark && restored.bg === before.bg;
          const themeAssertions = [
            {
              ok: flippedOk,
              label: "Переключение темы меняет dark-класс и фон",
              detail: `before(dark=${before.dark}, bg=${before.bg}) -> toggled(dark=${toggled.dark}, bg=${toggled.bg})`,
            },
            {
              ok: restoredOk,
              label: "Повторное нажатие возвращает исходную тему и фон",
              detail: `restored(dark=${restored.dark}, bg=${restored.bg})`,
            },
          ];

          screenReport.pathname = inspected.pathname;
          screenReport.theme = toggled;
          screenReport.assertions = [...inspected.assertions, ...themeAssertions];
          screenReport.failedAssertions = screenReport.assertions.filter((a) => !a.ok);
          screenReport.englishPhrases = inspected.englishPhrases;
          screenReport.unexpectedEnglishPhrases = inspected.unexpectedEnglishPhrases;
          screenReport.dynamicMasks = inspected.dynamicMasks;
          screenReport.extra = { before, toggled, restored };
        } else {
          if (screen.action) {
            const actRes = await client.probe("performAction", screen.action);
            if (!actRes.ok) throw new Error(`Action failed: ${actRes.detail}`);
          }

          if (screen.ensureDraft) {
            const deadline = Date.now() + 8000;
            while (!(await client.probe("ensureDraft"))) {
              if (Date.now() >= deadline) throw new Error("Could not find a draft or Start without a project");
              await client.pumpFrames(1, 200);
            }
          }
          const readyRes = await waitUntilReady(client, screen.waitFor);
          if (opts.allowOfflineServices && screen.expectOffline?.length) {
            const offlineReady = await waitUntilReady(client, { assertions: screen.expectOffline });
            if (!offlineReady.ready) throw new Error(offlineReady.detail);
          }
          await settleScreen(client, screen.settleMs ?? 700);

          const inspected = await client.probe("inspectScreen", {
            expect,
            englishScan: checks.englishScan,
            cleanProfile: opts.profile === "clean",
            excludeEnglishSelectors: screen.excludeEnglishSelectors,
            allowedEnglish,
            maskSelectors: mergedMaskSelectors,
          });

          screenReport.pathname = inspected.pathname;
          screenReport.theme = inspected.theme;
          screenReport.assertions = inspected.assertions;
          screenReport.failedAssertions = inspected.failedAssertions;
          screenReport.englishPhrases = inspected.englishPhrases;
          screenReport.unexpectedEnglishPhrases = inspected.unexpectedEnglishPhrases;
          screenReport.dynamicMasks = inspected.dynamicMasks;
          if (!readyRes.ready) {
            screenReport.extra = { waitWarning: readyRes.detail };
          }

          if (opts.screenshots) {
            if (checks.reducedMotion !== false) {
              await client.probe("freezeInfiniteAnimations");
              await client.pumpFrames(1, 100);
            }
            const shotRes = await client.send("Page.captureScreenshot", { format: "png" });
            const shotName = `${screen.id}.png`;
            writeFileSync(join(opts.outDir, shotName), Buffer.from(shotRes.data, "base64"));
            screenReport.screenshot = shotName;
          }
        }

        // Run teardown actions.
        if (Array.isArray(screen.teardown)) {
          for (const step of screen.teardown) {
            await client.probe("performAction", step);
          }
          await client.pumpFrames(2, 200);
        }

        const classified = classifyEvents(
          client.events,
          checks.localServicePorts,
          opts.allowOfflineServices,
        );
        screenReport.errors = classified.errors;
        screenReport.ignoredNetworkErrors = classified.ignoredNetworkErrors;
        screenReport.ok =
          screenReport.failedAssertions.length === 0 &&
          screenReport.errors.length === 0 &&
          (!opts.strictEn || screenReport.unexpectedEnglishPhrases.length === 0);
      } catch (err) {
        const classified = classifyEvents(
          client.events,
          checks.localServicePorts,
          opts.allowOfflineServices,
        );
        screenReport.errors = [
          ...classified.errors,
          { kind: "runner", text: String(err?.message || err) },
        ];
        screenReport.ignoredNetworkErrors = classified.ignoredNetworkErrors;
        screenReport.ok = false;
      }

      screenReport.durationMs = Date.now() - screenStart;
      report.screens.push(screenReport);
      const statusTag = screenReport.ok ? "PASS" : "FAIL";
      client.clearEvents();
      console.log(
        `[${statusTag}] screen/${screen.id} (${screenReport.durationMs}ms, assertions=${screenReport.assertions.length - screenReport.failedAssertions.length}/${screenReport.assertions.length}, errors=${screenReport.errors.length}, en=${screenReport.englishPhrases.length})`,
      );
      if (!screenReport.ok) {
        for (const f of screenReport.failedAssertions) {
          console.log(`       FAIL assertion: ${f.label} — ${f.detail}`);
        }
        for (const e of screenReport.errors) {
          console.log(`       ERROR [${e.kind}]: ${e.text}${e.url ? ` (${e.url})` : ""}`);
        }
      }
    }

    const screensPassed = report.screens.filter((s) => s.ok).length;
    const skippedChecks = report.screens.filter((s) => s.skipped).length;
    const totalChecks = 2 + report.screens.length;
    const passedChecks =
      (report.checks.globals.ok ? 1 : 0) + (report.checks.scheme.ok ? 1 : 0) + screensPassed;
    const allEnglish = [...new Set(report.screens.flatMap((s) => s.englishPhrases))].sort();
    const allUnexpectedEnglish = [
      ...new Set(report.screens.flatMap((s) => s.unexpectedEnglishPhrases)),
    ].sort();

    report.finishedAt = new Date().toISOString();
    report.summary = {
      totalChecks,
      passedChecks,
      skippedChecks,
      failedChecks: totalChecks - passedChecks - skippedChecks,
      globalsOk: report.checks.globals.ok,
      schemeOk: report.checks.scheme.ok,
      screensPassed,
      screensTotal: report.screens.length,
      totalErrors: report.screens.reduce((acc, s) => acc + s.errors.length, 0),
      uniqueEnglishPhrases: allEnglish.length,
      unexpectedEnglishPhrases: allUnexpectedEnglish,
    };
    report.ok = report.summary.failedChecks === 0;

    writeFileSync(join(opts.outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

    console.log("");
    console.log(`App version: ${report.app.version}`);
    console.log(
      `[${report.checks.globals.ok ? "PASS" : "FAIL"}] globals: ${report.checks.globals.presentCount}/${report.checks.globals.expectedCount} (missing=${report.checks.globals.missing.length}, extra=${report.checks.globals.extra.length})`,
    );
    console.log(
      `[${report.checks.scheme.ok ? "PASS" : "FAIL"}] scheme: index=${report.checks.scheme.index.status}, wasm=${report.checks.scheme.wasm.map((w) => `${w.url}:${w.status}`).join(", ") || "none"}`,
    );
    console.log(
      `Summary: ${report.summary.passedChecks}/${report.summary.totalChecks} checks passed, skipped=${skippedChecks}, errors=${report.summary.totalErrors}, unexpected_en=${report.summary.unexpectedEnglishPhrases.length}`,
    );
    console.log(`Report saved to: ${join(opts.outDir, "report.json")}`);

    process.exitCode = report.ok ? 0 : 1;
  } finally {
    if (client) {
      try {
        for (const globalName of [
          "__olyIntegrations",
          "__olyMcpManager",
          "__olyPromptsSettings",
          "__olyTasks",
          "__olyStudioShell",
          "__olyPlanUi",
        ]) {
          await client.probe("performAction", { type: "closeOlympus", global: globalName });
        }
        if (initialTheme) {
          const curTheme = await client.probe("getThemeState");
          if (curTheme && curTheme.dark !== initialTheme.dark) {
            await client.probe("performAction", {
              type: "click",
              selector: "button[aria-label='День / ночь']",
              optional: true,
            });
            await client.pumpFrames(2, 250);
          }
        }
        await client.probe("performAction", { type: "navigate", to: "/" });
        await client.pumpFrames(2, 200);
        await client.probe("resumeInfiniteAnimations");
        await client.send("Emulation.setEmulatedMedia", { features: [] });
        await client.send("Emulation.clearDeviceMetricsOverride");
      } catch {
        // Best-effort cleanup.
      }
      await client.close();
    }
    if (launchedChild && !opts.keepOpen) {
      killProcessTree(launchedChild.pid);
    }
  }
}

run().catch((err) => {
  console.error(`Smoke runner failed: ${err?.stack || err}`);
  process.exit(1);
});

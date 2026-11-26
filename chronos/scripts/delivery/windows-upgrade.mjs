import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, openSync } from "node:fs";
import { appendFile, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { connectCdp, rpcClient } from "../bench/client.mjs";
import { startUpgradeMirror } from "./upgrade-mirror.mjs";

assert.equal(process.platform, "win32");
assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted", "The installer requires a disposable Windows VM");
const { RUNNER_TEMP, FROM_VERSION: from, TO_VERSION: to, GITHUB_REPOSITORY: repository } = process.env;
const versionPattern = /^\d+\.\d+\.\d+-nightly\.\d+\.\d+\.chronos\.\d+$/u;
assert.match(from, versionPattern); assert.match(to, versionPattern); assert.notEqual(from, to);
const root = path.join(RUNNER_TEMP, "chronos-upgrade"), evidence = path.join(root, "evidence");
// NSIS can relaunch via Explorer, without the original launcher environment.
const home = path.join(homedir(), ".chronos"), data = path.join(home, "userdata"), projectRoot = path.join(root, "project");
assert.equal(await exists(home), false, "Expected a fresh Windows user profile");
await Promise.all([evidence, data, projectRoot].map(dir => mkdir(dir, { recursive: true })));
const { GH_TOKEN, ...childEnv } = process.env;
const env = { ...childEnv, CHRONOS_HOME: home, T3CODE_HOME: home, T3CODE_PORT: "28581", T3CODE_TELEMETRY_ENABLED: "false" };
const cdpOrigin = "http://127.0.0.1:29481";
const exe = path.join(process.env.LOCALAPPDATA, "Programs", "chronos", "Chronos.exe");
const resources = path.join(path.dirname(exe), "resources");
const projectId = randomUUID(), threadId = randomUUID(), title = "Chronos upgrade fixture";
const summary = { from, to, timings: [], status: "failed" };
const files = new Map();
let mirror, cdp, artifactId, oldRuntime, oldShell, oldIdentity;
const gh = args => execFileSync("gh", args, { encoding: "utf8", timeout: 240000, windowsHide: true });
async function exists(file) { return !!await stat(file).catch(() => null); }
async function sha(file, algorithm, encoding) {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest(encoding);
}
async function step(name, run) {
  const start = Date.now();
  let status = "failed";
  try { const value = await run(); status = "passed"; return value; }
  finally { summary.timings.push({ name, status, seconds: (Date.now() - start) / 1000 }); }
}
async function waitFor(label, probe, timeout = 90000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { const value = await probe(); if (value) return value; } catch (error) { last = error; }
    await delay(350);
  }
  throw Error("Timeout: " + label, { cause: last });
}
const appName = version => "Chronos-" + version + "-x64.exe";
const releasePath = (version, name) => "/" + repository + "/releases/download/chronos-v" + version + "/" + name;
const feedDir = "/" + repository + "/releases/latest/download";
async function fetchRelease(version) {
  const tag = "chronos-v" + version, name = appName(version), dir = path.join(root, version);
  const release = JSON.parse(gh(["release", "view", tag, "-R", repository, "--json", "tagName,isDraft,assets"]));
  assert.equal(release.tagName, tag); assert.equal(release.isDraft, false);
  const names = [name, name + ".blockmap", ...(version === to ? ["nightly.yml"] : [])];
  gh(["release", "download", tag, "-R", repository, "-D", dir, ...names.flatMap(n => ["-p", n])]);
  for (const assetName of names) {
    const digest = release.assets.find(a => a.name === assetName)?.digest;
    assert.equal("sha256:" + await sha(path.join(dir, assetName), "sha256", "hex"), digest, assetName);
    files.set(assetName === "nightly.yml" ? assetName : releasePath(version, assetName), path.join(dir, assetName));
  }
}
async function runtime() {
  const info = JSON.parse(await readFile(path.join(data, "server-runtime.json"), "utf8"));
  const url = new URL(info.origin);
  assert.equal(url.protocol, "http:"); assert.equal(url.hostname, "127.0.0.1");
  const r = await fetch(url.origin + "/.well-known/t3/environment");
  assert.ok(r.ok);
  return { origin: url.origin, pid: info.pid, identity: (await r.json()).environmentId };
}
async function connectPage() {
  const tabs = await (await fetch(cdpOrigin + "/json/list")).json();
  const page = tabs.find(t => t.type === "page" && t.url.startsWith("t3code://app/"));
  if (!page) return;
  cdp = await connectCdp(page.webSocketDebuggerUrl);
  return true;
}
async function evaluate(expression) {
  const reply = await cdp.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (reply.exceptionDetails) throw Error(reply.exceptionDetails.exception?.description || reply.exceptionDetails.text);
  return reply.result.value;
}
async function withRpc(callback) {
  const { origin } = await runtime();
  const entry = path.join(resources, "server.asar/apps/server/dist/bin.mjs");
  const bearer = execFileSync(exe, [entry, "auth", "session", "issue", "--token-only", "--label", "upgrade-fixture"],
    { env: { ...env, ELECTRON_RUN_AS_NODE: "1" }, encoding: "utf8", windowsHide: true }).trim();
  const post = async (route, body) => {
    const r = await fetch(origin + route, { method: "POST", headers: { authorization: "Bearer " + bearer, "content-type": "application/json" }, ...(body && { body: JSON.stringify(body) }) });
    assert.ok(r.ok, route + " HTTP " + r.status); return r;
  };
  const { ticket } = await (await post("/api/auth/websocket-ticket/rpc")).json();
  const rpc = await rpcClient(origin.replace("http:", "ws:") + "/ws?orchestrationProtocol=2&wsTicket=" + encodeURIComponent(ticket));
  try { return await callback(rpc, post); } finally { rpc.close(); }
}
async function shellState() {
  const result = JSON.parse(execFileSync("pwsh.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(import.meta.dirname, "upgrade-shell.ps1"), "-Executable", exe, "-ArtifactId", artifactId], { encoding: "utf8", windowsHide: true }));
  const expected = (await realpath(exe)).toLowerCase();
  for (const target of [result.protocolTarget, ...result.shortcuts.map(s => s.target)]) assert.equal((await realpath(target)).toLowerCase(), expected);
  return result;
}
async function openStore() {
  const { openArtifacts } = await import(pathToFileURL(path.join(resources, "chronos-services/artifacts/store.mjs")).href);
  return openArtifacts(home);
}
try {
  await step("Fetch and verify both published releases", async () => {
    await fetchRelease(from); await fetchRelease(to);
    const name = appName(to);
    const feed = await readFile(files.get("nightly.yml"), "utf8");
    const target = releasePath(to, name);
    const sourceUrl = "https://github.com" + target;
    assert.ok(feed.includes(sourceUrl), "Expected version-pinned Windows installer URL");
    assert.ok(feed.includes(await sha(files.get(target), "sha512", "base64")));
    summary.installerBytes = (await stat(files.get(target))).size;
    mirror = await startUpgradeMirror({
      assets: files, target, manifestPath: feedDir + "/nightly.yml", upstreamInstaller: sourceUrl,
      manifest: origin => feed.replaceAll("https://github.com" + "/" + repository + "/", origin + "/" + repository + "/"),
    });
  });
  await step("Silent NSIS installation", async () => {
    assert.equal(await exists(exe), false, "Expected a clean VM");
    execFileSync(files.get(releasePath(from, appName(from))), ["/S"], { env, timeout: 150000, windowsHide: true });
    assert.ok(await exists(exe));
    // Route the installed updater to the byte-counting mirror, keeping the packaged provider options.
    const config = path.join(resources, "app-update.yml");
    const original = await readFile(config, "utf8"); assert.match(original, /^provider: generic\s*$/m);
    assert.match(original, /^url: https:\/\/.*$/m);
    await writeFile(config, original.replace(/^url: https:\/\/.*$/m, "url: " + mirror.origin + feedDir));
    const drivers = ["codex", "claudeAgent", "cursor", "grok", "muse", "pi", "opencode", "antigravity", "kiro", "fx"];
    await writeFile(path.join(data, "settings.json"), JSON.stringify({
      backgroundActivityProfile: "battery-saver", automaticGitFetchInterval: 0, responseStreamingMode: "paragraph",
      providerInstances: Object.fromEntries(drivers.map(driver => [driver, { driver, enabled: false }])),
    }));
  });
  await step("Launch source build and seed user data", async () => {
    const fd = openSync(path.join(evidence, "desktop.log"), "a");
    const proc = spawn(exe, ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=29481"],
      { env, stdio: ["ignore", fd, fd], windowsHide: true });
    proc.unref();
    oldRuntime = await waitFor("source backend", runtime);
    await waitFor("source window", connectPage);
    await waitFor("source renderer", async () => (await evaluate("window.desktopBridge.getUpdateState()")).currentVersion === from);
    await withRpc(async (rpc, post) => {
      await post("/api/projects/mutate", { type: "project.create", commandId: randomUUID(), projectId, title, workspaceRoot: projectRoot });
      await rpc.call("orchestration.dispatchCommand", { type: "thread.create", commandId: randomUUID(), projectId, threadId,
        title, runtimeMode: "approval-required", interactionMode: "default", modelSelection: { instanceId: "codex", model: "offline" },
        createdBy: "user", creationSource: "web", branch: null, worktreePath: null });
    });
    const store = await openStore();
    try {
      ({ id: artifactId } = store.publish({ source: path.join(projectRoot,"fixture.html"), title, label: "QA", icon: "Q",
        description: title, capabilities: ["db"], files: { "index.html": "<!doctype html><title>QA</title><p>QA</p>" } }));
      store.documents(artifactId, "set", { collection: "qa", key: "thread", value: { threadId } });
    } finally { store.close(); }
    const click = selector => evaluate(`(() => {
      const button = document.querySelector(${JSON.stringify(selector)});
      if (!button || button.disabled) return false;
      button.click();
      return true;
    })()`);
    const route = "/" + oldRuntime.identity + "/" + threadId;
    await waitFor("thread route", () => evaluate(`window.__TSR_ROUTER__?.navigate({ to: ${JSON.stringify(route)} }).then(() => true)`));
    await waitFor("native gallery button", () => click('button[aria-label="Артефакты"]'));
    // Older builds use the Studio gallery; newer builds use the native gallery.
    // Both deliver the same packaged Studio open request to the desktop window.
    await waitFor("gallery opened", () => evaluate(`Boolean(document.querySelector('[data-artifact-gallery],dialog iframe[src*="/artifacts.html"],webview[src*="/artifacts.html"]'))`));
    const { showArtifact } = await import(pathToFileURL(path.join(resources, "chronos-services/artifacts/gallery.mjs")));
    await waitFor("Studio delivered the fixture", () => showArtifact(artifactId));
    await waitFor("artifact view", () => evaluate(`Boolean(document.querySelector('webview[src^="chronos-artifact://${artifactId}/"]'))`));
    await waitFor("install as app command", () => evaluate(`(() => {
      const button = [...document.querySelectorAll("button")].find(b => b.getClientRects().length && !b.disabled && b.textContent === "Установить как приложение");
      if (button) { button.click(); return true; }
      if (!document.querySelector(".art-menu")) document.querySelector('button[aria-label="Действия"]')?.click();
      return false;
    })()`));
    await waitFor("artifact shortcut ownership", () => evaluate(`window.chronosArtifactInstaller.installed(${JSON.stringify(artifactId)})`));
    oldShell = await shellState();
    oldIdentity = await readFile(path.join(data, "environment-id"), "utf8");
  });
  await step("Check offer and download using installed electron-updater", async () => {
    const cache = path.join(process.env.LOCALAPPDATA, "chronos-updater", "installer.exe");
    summary.cachedInstallerPresent = await exists(cache);
    await evaluate("void window.desktopBridge.checkForUpdate(); true");
    const state = () => evaluate("window.desktopBridge.getUpdateState()");
    await waitFor("exact version offered", async () => (await state()).availableVersion === to);
    await evaluate("void window.desktopBridge.downloadUpdate(); true");
    await waitFor("verified download", async () => (await state()).downloadedVersion === to, 150000);
    summary.transfer = mirror.transfer();
    if (summary.transfer.fullBytes > 0) {
      const log = await readFile(path.join(evidence, "desktop.log"), "utf8");
      const rejected = mirror.requests.find(r => r.range && r.status >= 400);
      const detail = log.split(/\r?\n/).find(s => /fallback to full download|cannot download differentially/i.test(s));
      summary.fullDownloadReason = detail || (rejected && "CDN rejected a range request with HTTP " + rejected.status) || (!summary.cachedInstallerPresent ? "No previous installer in the updater cache after clean NSIS installation" : null);
      assert.ok(summary.fullDownloadReason, "No explanation for the full download");
    } else { assert.ok(summary.transfer.rangeBytes && summary.transfer.rangeBytes < summary.installerBytes); }
  });
  await step("Apply the downloaded NSIS update and wait for its automatic restart", async () => {
    await evaluate(`void window.desktopBridge.installUpdate(${JSON.stringify(to)}); true`);
    await waitFor("updated backend in the same profile", async () => {
      const r = await runtime();
      return r.pid !== oldRuntime.pid && r.identity === oldRuntime.identity &&
        (await readFile(path.join(data, "desktop-last-started-version"), "utf8")).trim() === to;
    }, 180000);
  });
  await step("Verify project, thread, settings, artifact, shortcuts and protocol", async () => {
    assert.equal(await readFile(path.join(data, "environment-id"), "utf8"), oldIdentity);
    const settings = JSON.parse(await readFile(path.join(data, "settings.json"), "utf8"));
    assert.equal(settings.backgroundActivityProfile, "battery-saver"); assert.equal(settings.responseStreamingMode, "paragraph");
    await withRpc(async rpc => {
      const projection = await rpc.call("orchestration.getThreadProjection", { threadId });
      assert.equal(projection.thread.id, threadId); assert.equal(projection.thread.projectId, projectId);
      assert.equal(projection.thread.title, title);
    });
    const store = await openStore();
    try { assert.equal(store.metadata(artifactId).title, title); assert.deepEqual(store.documents(artifactId, "get", {collection:"qa",key:"thread"}), { threadId }); }
    finally { store.close(); }
    assert.deepEqual(await shellState(), oldShell);
    summary.continuity = { projectId, threadId, artifactId, shortcuts: oldShell.shortcuts.length, protocol: "chronos" };
  });
  summary.status = "passed";
} catch (error) {
  summary.error = String(error.stack || error); process.exitCode = 1; console.error(error);
} finally {
  cdp?.close();
  // Persist the actual post-install state even if NSIS never restarts the app.
  const inspect = async (file) => (await readFile(file, "utf8").catch(() => null))?.trim();
  summary.lastStartedVersion = await inspect(path.join(data, "desktop-last-started-version"));
  summary.backend = await runtime().catch(() => null);
  summary.installedVersion = execFileSync("pwsh.exe", ["-NoProfile", "-Command",
    "if(Test-Path -LiteralPath $env:UPGRADE_EXECUTABLE){(Get-Item -LiteralPath $env:UPGRADE_EXECUTABLE).VersionInfo.ProductVersion}"],
    { env: { ...env, UPGRADE_EXECUTABLE: exe }, encoding: "utf8", windowsHide: true }).trim();

  if (mirror) { summary.transfer = mirror.transfer(); await writeFile(path.join(evidence, "requests.json"), JSON.stringify(mirror.requests, null, 2)); await mirror.close(); }
  await writeFile(path.join(evidence, "report.json"), JSON.stringify(summary, null, 2));
  const rows = summary.timings.map(s => `| ${s.name} | ${s.status} | ${s.seconds.toFixed(1)} |`);
  await appendFile(process.env.GITHUB_STEP_SUMMARY, [`## ${from} → ${to}`, "", "| Step | Result | Seconds |", "|---|---|---:|", ...rows, "",
    `Transfer bytes (range / full / blockmaps / manifest): ${summary.transfer?.rangeBytes ?? 0} / ${summary.transfer?.fullBytes ?? 0} / ${summary.transfer?.mapBytes ?? 0} / ${summary.transfer?.manifestBytes ?? 0}.`,
    `Full-download reason: ${summary.fullDownloadReason ?? (summary.transfer?.fullBytes ? "unknown" : "none")}.`, summary.error ? `\nFailure: ${summary.error.split("\n")[0]}` : "", ""].join("\n"));
}

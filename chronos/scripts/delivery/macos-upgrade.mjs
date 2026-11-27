import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, appendFile, copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseUpdateManifest } from "../../../scripts/lib/update-manifest.ts";
import { connectCdp } from "../bench/client.mjs";
import { pinReleaseFeed } from "./release-feed.mjs";
import { startUpgradeMirror } from "./upgrade-mirror.mjs";

assert.equal(process.platform, "darwin");
assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
const { RUNNER_TEMP: temp, GITHUB_REPOSITORY: repo } = process.env;
const manifest = await readFile("release/nightly-mac.yml", "utf8");
const { version: to } = parseUpdateManifest(manifest, "nightly-mac.yml", "mac");
const from = to.replace(/\d+$/, revision => String(Number(revision) - 1));
assert.notEqual(from, to);
const file = version => `Chronos-${version}-arm64.zip`;
const source = path.join(temp, "chronos-update-source", file(from));
const assets = new Map();
const releasePath = v => `/${repo}/releases/download/chronos-v${v}/${file(v)}`;
for (const [v, zip] of [[from, source], [to, path.resolve("release", file(to))]]) {
  assets.set(releasePath(v), zip);
  assets.set(releasePath(v) + ".blockmap", zip + ".blockmap");
}
const feed = pinReleaseFeed(manifest, to, repo, "mac");
const dir = path.join(homedir(), "Applications");
await mkdir(dir, { recursive: true });
await assert.rejects(access(path.join(dir, "Chronos.app")), { code: "ENOENT" });
execFileSync("ditto", ["-x", "-k", source, dir]);
const app = path.join(dir, "Chronos.app");
const requirement = () => execFileSync("bash", ["chronos/ci/verify-macos-signature.sh", app], { encoding: "utf8" }).trim();
const codeHash = () => {
  const display = spawnSync("codesign", ["--display", "--verbose=4", app], { encoding: "utf8" });
  assert.equal(display.status, 0);
  const hash = /^CDHash=([a-f0-9]{40})$/mi.exec(display.stderr)?.[1];
  assert.ok(hash, "expected a Mach-O code directory hash");
  return hash;
};
const oldCodeHash = codeHash();
const oldRequirement = requirement();
const config = await readFile(path.join(app, "Contents/Resources/app-update.yml"), "utf8");
assert.match(config, /^url: http:\/\/localhost:29482\/?\s*$/m);
assert.match(config, /^useMultipleRangeRequest: false\s*$/m);
const cacheName = /^updaterCacheDirName: ([\w.-]+)$/m.exec(config)?.[1];
assert.ok(cacheName && !cacheName.startsWith("."));
const cache = path.join(homedir(), "Library/Caches", cacheName);
await mkdir(cache, { recursive: true });
// A prior successful MacUpdater download leaves this exact ZIP. Fetch the old map over HTTP.
await copyFile(source, path.join(cache, "update.zip"), constants.COPYFILE_EXCL);
const home = path.join(homedir(), ".chronos");
const started = path.join(home, "userdata/desktop-last-started-version");
const log = path.join(temp, "chronos-upgrade.log");
const mirror = await startUpgradeMirror({
  port: 29482, assets, target: releasePath(to), manifestPath: "/nightly-mac.yml",
  manifest: origin => feed.replaceAll("https://github.com/", origin + "/"),
});
let cdp;
async function until(label, probe, timeout = 120000) {
  const end = Date.now() + timeout;
  let last;
  do {
    try { const value = await probe(); if (value) return value; } catch (error) { last = error; }
    await delay(300);
  } while (Date.now() < end);
  throw Error("Timeout waiting for " + label, { cause: last });
}
async function evaluate(expression) {
  const result = await cdp.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
function launchWithDevTools() {
  // Use the same LaunchServices registration and GUI session as opening the installed app in Finder.
  execFileSync("/usr/bin/open", ["-n", "-a", app, "--stdout", log, "--stderr", log,
    "--args", "--remote-debugging-port=29481"]);
}
const installedVersion = () => execFileSync("/usr/libexec/PlistBuddy",
  ["-c", "Print :CFBundleShortVersionString", path.join(app, "Contents/Info.plist")],
  { encoding: "utf8" }).trim();
const processList = () => execFileSync("/bin/ps", ["-axo", "pid=,ppid=,comm="], { encoding: "utf8" });
const appTool = path.join(temp, "chronos-test-app");
execFileSync("swiftc", ["chronos/scripts/delivery/macos-test-app.swift", "-o", appTool]);
const appPid = () => execFileSync(appTool, ["pid", app], { encoding: "utf8" }).trim();
const connectWindow = () => until("Chronos window", async () => {
  const targets = await (await fetch("http://127.0.0.1:29481/json/list")).json();
  const page = targets.find(t => t.type === "page" && t.url.startsWith("t3code://app/"));
  return page && connectCdp(page.webSocketDebuggerUrl);
});
async function keychainObservation(pid, newHash) {
  // Never interact with the dialog. Expose only the name of the fixture's window or
  // the Security framework operation in Chronos, never item data or raw stack samples.
  const window = execFileSync(appTool, ["keychain-window", app], { encoding: "utf8" }).trim();
  if (window === "Chronos Safe Storage") return "Chronos Safe Storage dialog";
  const processes = processList();
  if (!processes.includes("/SecurityAgent.bundle/Contents/MacOS/SecurityAgent")) return;
  const sample = path.join(temp, "chronos-upgrade.sample");
  // Chromium can read cookies in an app-owned network helper instead of Electron's main process.
  const helpers = processes.split("\n").flatMap(line => {
    const row = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    return row && row[2] === pid && row[3].startsWith(app + "/Contents/") ? [row[1]] : [];
  });
  for (const target of [pid, ...helpers]) {
    const sampled = spawnSync("/usr/bin/sample", [target, "1", "-file", sample], { stdio: "ignore", timeout: 4000 });
    if (sampled.status !== 0) continue;
    const stack = await readFile(sample, "utf8");
    const operations = stack.match(/SecItemCopyMatching(?:_osx)?|SecKeychainFindGenericPassword|SecKeychainItemCopyContent|SecKeychainItemCopyAttributesAndData|KeychainPassword::GetPassword/g);
    if (operations?.length) return `SecurityAgent with Chronos PID ${target} waiting in ${[...new Set(operations)].join(", ")}`;
  }
  const trace = spawnSync("/usr/bin/log", ["show", "--last", "3m", "--info", "--style", "compact",
    "--predicate", `process == "securityd" AND eventMessage CONTAINS[c] "partition" AND eventMessage CONTAINS[c] "${newHash}"`],
    { encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024 });
  if (trace.status === 0 && /partition mismatch/i.test(trace.stdout)) return "securityd rejected the new cdhash and started SecurityAgent";
}
launchWithDevTools();
try {
  await until("installed source process", async () => (await readFile(started, "utf8")).trim() === from);
  cdp = await connectWindow();
  const state = () => evaluate("window.desktopBridge.getUpdateState()");
  assert.equal((await state()).currentVersion, from);
  const marker = randomUUID();
  const fixture = JSON.stringify({
    schemaVersion: 1, targets: [], profiles: [], credentials: [], remoteDpopTokens: [],
    disabledEnvironmentIds: [marker],
  });
  assert.equal(await evaluate(`window.desktopBridge.setConnectionCatalog(${JSON.stringify(fixture)})`), true);
  const stored = JSON.parse(await readFile(path.join(home, "userdata/connection-catalog.json"), "utf8"));
  assert.ok(stored.encryptedCatalog && !JSON.stringify(stored).includes(marker));
  await evaluate("window.desktopBridge.checkForUpdate()");
  await until("local feed offers N+1", async () => (await state()).availableVersion === to);
  await evaluate("void window.desktopBridge.downloadUpdate().then(r => window.updateReceipt = r); true");
  const downloaded = await until("download receipt", () => evaluate("window.updateReceipt"));
  assert.ok(downloaded.accepted && downloaded.completed, JSON.stringify(downloaded));
  assert.equal((await state()).downloadedVersion, to);
  const transfer = mirror.transfer();
  const size = (await stat(assets.get(releasePath(to)))).size;
  assert.equal(transfer.fullBytes, 0, JSON.stringify(transfer));
  assert.ok(transfer.rangeBytes > 0 && transfer.rangeBytes < size && transfer.mapBytes > 0);
  console.log(`Differential ZIP: ${transfer.rangeBytes} / ${size} bytes; blockmaps: ${transfer.mapBytes} bytes`);
  const oldPid = appPid();
  assert.ok(oldPid, "source app registered in GUI session");
  await evaluate(`void window.desktopBridge.installUpdate(${JSON.stringify(to)}); true`);
  await until("ShipIt replaces installed bundle", () => installedVersion() === to);
  const newPid = await until("LaunchServices starts the replacement process", () => {
    const pid = appPid();
    return pid !== oldPid && pid;
  });
  assert.equal(requirement(), oldRequirement);
  assert.equal(installedVersion(), to);
  const newHash = codeHash();
  assert.notEqual(newHash, oldCodeHash);
  cdp.close();
  let nextObservation = Date.now() + 6000;
  const keychain = await until("new backend ready or verified Keychain authorization request", async () => {
    if ((await readFile(started, "utf8")).trim() === to) return "ready";
    if (Date.now() < nextObservation) return;
    nextObservation = Date.now() + 12000;
    return keychainObservation(newPid, newHash);
  });
  let result = `Keychain requested authorization again (${keychain}). No consent was supplied.`;
  if (keychain === "ready") {
    // ShipIt launched N+1 without the test debugger. Reopen the already verified app
    // to check real decryption of N's fixture through its normal IPC.
    execFileSync(appTool, ["quit", app], { timeout: 30000 });
    launchWithDevTools();
    cdp = await connectWindow();
    assert.equal((await state()).currentVersion, to);
    const restored = JSON.parse(await evaluate("window.desktopBridge.getConnectionCatalog()"));
    assert.ok(restored?.disabledEnvironmentIds?.includes(marker));
    result = "N+1 decrypted N's Keychain-protected catalog without a prompt.";
  }
  const report = `Squirrel.Mac installed and relaunched **${from} → ${to}** (PID ${oldPid} → ${newPid}). Identical DR; cdhash ${oldCodeHash} → ${newHash}. ZIP ranges: ${transfer.rangeBytes} / ${size} bytes. Blockmaps: ${transfer.mapBytes} bytes. ${result}\n`;
  console.log(report);
  await appendFile(process.env.GITHUB_STEP_SUMMARY, report);
} catch (error) {
  console.error("Installed bundle:", installedVersion(), "last ready:", await readFile(started, "utf8").catch(() => "unavailable"));
  console.error(processList().split("\n").filter(line => /Chronos|ShipIt|SecurityAgent/.test(line)).slice(-25).join("\n"));
  const shipit = path.join(homedir(), "Library/Caches/io.github.zulut30.chronos.ShipIt");
  for (const name of ["ShipIt_stderr.log", "ShipIt_stdout.log"]) {
    const lines = await readFile(path.join(shipit, name), "utf8").catch(() => "");
    if (lines) console.error(name, lines.split("\n").slice(-30).join("\n"));
  }
  // Only updater diagnostics from this disposable profile; the private keychain has already been deleted.
  console.error((await readFile(log, "utf8").catch(() => "")).split("\n").filter(line => /updat|Squirrel|ShipIt/i.test(line)).slice(-35).join("\n"));
  throw error;
} finally {
  cdp?.close();
  try { execFileSync(appTool, ["quit", app], { timeout: 30000 }); } catch { /* Already quit. */ }
  await mirror.close();
}

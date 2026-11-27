import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { constants, openSync, closeSync } from "node:fs";
import { appendFile, copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { connectCdp } from "../bench/client.mjs";
import { pinReleaseFeed } from "./release-feed.mjs";
import { startUpgradeMirror } from "./upgrade-mirror.mjs";

assert.equal(process.platform, "darwin");
assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
const { VERSION: to, RUNNER_TEMP: temp, GITHUB_REPOSITORY: repo } = process.env;
const from = to.replace(/\.\d+$/, ".0");
assert.notEqual(from, to);
const file = version => `Chronos-${version}-arm64.zip`;
const source = path.join(temp, "chronos-update-source", file(from));
const assets = new Map();
const releasePath = v => `/${repo}/releases/download/chronos-v${v}/${file(v)}`;
for (const [v, zip] of [[from, source], [to, path.resolve("release", file(to))]]) {
  assets.set(releasePath(v), zip);
  assets.set(releasePath(v) + ".blockmap", zip + ".blockmap");
}
const feed = pinReleaseFeed(await readFile("release/nightly-mac.yml", "utf8"), to, repo, "mac");
const dir = path.join(temp, "upgrade-apps");
await mkdir(dir);
execFileSync("ditto", ["-x", "-k", source, dir]);
const app = path.join(dir, "Chronos.app");
const requirement = () => execFileSync("bash", ["chronos/ci/verify-macos-signature.sh", app], { encoding: "utf8" }).trim();
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
const fd = openSync(log, "a");
const child = spawn(path.join(app, "Contents/MacOS/Chronos"), ["--remote-debugging-port=29481"], {
  stdio: ["ignore", fd, fd],
});
closeSync(fd);
child.unref();
try {
  await until("installed source process", async () => (await readFile(started, "utf8")).trim() === from);
  cdp = await until("Chronos window", async () => {
    const targets = await (await fetch("http://127.0.0.1:29481/json/list")).json();
    const page = targets.find(t => t.type === "page" && t.url.startsWith("t3code://app/"));
    return page && connectCdp(page.webSocketDebuggerUrl);
  });
  const state = () => evaluate("window.desktopBridge.getUpdateState()");
  assert.equal((await state()).currentVersion, from);
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
  await evaluate(`void window.desktopBridge.installUpdate(${JSON.stringify(to)}); true`);
  await until("automatically relaunched N+1", async () => (await readFile(started, "utf8")).trim() === to);
  assert.equal(requirement(), oldRequirement);
  const plist = path.join(app, "Contents/Info.plist");
  assert.equal(execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleShortVersionString", plist], { encoding: "utf8" }).trim(), to);
  const report = `Squirrel.Mac relaunched **${from} → ${to}**. Identical DR. ZIP ranges: ${transfer.rangeBytes} / ${size} bytes. Blockmaps: ${transfer.mapBytes} bytes.\n`;
  console.log(report);
  await appendFile(process.env.GITHUB_STEP_SUMMARY, report);
} catch (error) {
  // Only updater diagnostics from this disposable profile; the private keychain has already been deleted.
  console.error((await readFile(log, "utf8")).split("\n").filter(line => /updat|Squirrel|ShipIt/i.test(line)).slice(-35).join("\n"));
  throw error;
} finally {
  cdp?.close();
  if (child.exitCode === null && child.signalCode === null) child.kill();
  await mirror.close();
}

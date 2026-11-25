// Node 24+. Windows packaged Chronos, no install/build or provider credentials required.
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import assert from "node:assert/strict";

export function createSandbox(frames, interval, workload = "paragraph", streamingMode = "paragraph") {
  const git = execFileSync("where.exe", ["git.exe"], { encoding: "utf8" }).trim().split(/\r?\n/)[0];
  assert(existsSync(git));
  const tempRoot = realpathSync(tmpdir());
  const root = mkdtempSync(join(tempRoot, "chronos-bench-"));
  const home = join(root, "home"), userdata = join(home, "userdata"), work = join(root, "workspace");
  const fake = join(root, "user"), temp = join(root, "temp"), profile = join(root, "chrome");
  const children = [];
  const env = Object.fromEntries(["SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "SystemDrive", "ProgramFiles",
    "ProgramFiles(x86)", "ProgramW6432", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE"].map(k => [k, process.env[k]]).filter(([,v]) => v));
  Object.assign(env, { Path: [dirname(process.execPath), dirname(git), join(env.SystemRoot, "System32"), env.SystemRoot].join(";"),
    CHRONOS_HOME: home, T3CODE_HOME: home, HOME: fake, USERPROFILE: fake, APPDATA: join(fake, "Roaming"),
    LOCALAPPDATA: join(fake, "Local"), TEMP: temp, TMP: temp, XDG_DATA_HOME: join(fake, "data"),
    XDG_CONFIG_HOME: join(fake, "config"), CODEX_HOME: join(fake, "codex"), CLAUDE_CONFIG_DIR: join(fake, "claude"),
    GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", DO_NOT_TRACK: "1", T3CODE_TELEMETRY_ENABLED: "false", CI: "1" });
  for (const dir of [userdata, work, fake, temp, profile, env.APPDATA, env.LOCALAPPDATA]) mkdirSync(dir, { recursive: true });
  const run = (file, args, childEnv = env) => execFileSync(file, args, { env: childEnv, cwd: work,
    stdio: ["ignore","pipe","pipe"], encoding: "utf8", timeout: 30000, windowsHide: true });
  function start(file, args, childEnv) {
    const p = spawn(file, args, { cwd: work, env: childEnv, windowsHide: true, stdio: ["ignore","pipe","pipe"] });
    children.push(p);
    p.stdout.resume();
    p.errors = "";
    p.stderr.on("data", data => { p.errors = (p.errors + data).slice(-1800); });
    return p;
  }
  async function wait(label, test, timeout = 65000) {
    const until = Date.now() + timeout;
    do {
      for (const p of children) if (p.exitCode !== null) throw Error("Benchmark child exited with code " + p.exitCode);
      const result = await test();
      if (result) return result;
      await sleep(100);
    } while (Date.now() < until);
    throw Error("Timeout: " + label + " (" + root + ")");
  }
  async function port() {
    const s = createServer();
    await new Promise(resolve => s.listen(0, "127.0.0.1", resolve));
    const p = s.address().port;
    await new Promise(resolve => s.close(resolve));
    return p;
  }
  function stop(p) {
    if (!p.pid || p.exitCode !== null) return;
    try { execFileSync("taskkill.exe", ["/pid", String(p.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" }); }
    catch { if (p.exitCode === null) p.kill(); }
  }
  const modelSelection = { instanceId: "bench", model: "bench" };
  const disabled = ["codex","claudeAgent","cursor","grok","muse","pi","opencode","antigravity","kiro","fx"].map(driver =>
    [driver, { driver, enabled: false, ...(driver === "codex" ? { config: { binaryPath: join(fake,"disabled-model") } } : {}) }]);
  writeFileSync(join(userdata, "settings.json"), JSON.stringify({ defaultModelSelection: modelSelection,
    backgroundActivityProfile: "battery-saver", automaticGitFetchInterval: 0, responseStreamingMode: streamingMode,
    providerInstances: { ...Object.fromEntries(disabled), bench: { driver: "acpRegistry", enabled: true, displayName: "Bench",
      config: { source: "local", commandPath: process.execPath, commandArgs: [join(import.meta.dirname,"agent.mjs"), root, String(frames), String(interval), workload] } } } }));
  run(git, ["init", "-q", "-b", "main"]);
  run(git, ["-c","user.name=Bench","-c","user.email=bench@example.invalid","commit","--allow-empty","-qm","Fixture"]);
  function close() {
    children.reverse().forEach(stop);
    const owned = resolve(root);
    if (dirname(owned) === resolve(tempRoot) && /^chronos-bench-[a-z0-9]+$/i.test(basename(owned))) {
      rmSync(owned, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 });
    }
  }
  return { root, home, userdata, work, profile, env, run, start, wait, port, modelSelection, close };
}

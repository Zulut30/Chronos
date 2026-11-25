const { spawn } = require("node:child_process");
const { existsSync, mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");

function execute(file, args, { env, cwd, signal, stdin = "" }) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("Операция остановлена."));
    const child = spawn(file, args, { env, cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = Buffer.alloc(0);
    let over = false;
    const kill = () => child.kill();
    const timeout = setTimeout(kill, 32000).unref();
    signal.addEventListener("abort", kill, { once: true });
    child.stdout.on("data", data => {
      if (over) return;
      if (stdout.length + data.length > 2000000) { over = true; kill(); }
      else stdout = Buffer.concat([stdout, data]);
    });
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.stdin.end(stdin);
    child.once("error", () => reject(new Error("Не удалось запустить инструмент.")));
    child.once("close", code => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", kill);
      let reply;
      try { reply = JSON.parse(stdout.toString("utf8")); } catch { /* killed or incomplete output */ }
      if (signal.aborted || over || code !== 0 || !reply || reply.ok === false || reply.success === false) {
        const reason = reply?.error?.code;
        return reject(new Error(typeof reason === "string" && /^[A-Z_]{1,60}$/.test(reason) ? reason : "Инструмент не подтвердил действие."));
      }
      resolve(reply);
    });
  });
}

function ownWindow(helper, desk, exe, session, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(helper, [desk,"own",exe], { cwd:opts.cwd, env:opts.env, windowsHide:true, stdio:["pipe","pipe","pipe"] });
    session.owner = child;
    const cancel = () => child.kill();
    const timer = setTimeout(cancel,10000).unref();
    opts.signal.addEventListener("abort",cancel,{ once:true });
    const cleanup = () => { clearTimeout(timer); opts.signal.removeEventListener("abort",cancel); };
    const fail = () => { cleanup(); reject(new Error("Не удалось открыть приложение в фоне.")); };
    child.once("error",fail);
    child.once("exit",fail);
    child.stderr.resume();
    child.stdin.on("error",() => {});
    let output = "";
    child.stdout.on("data",data => {
      output += data;
      if (!output.includes("\n")) return;
      cleanup();
      try {
        const pid = JSON.parse(output).pid;
        if (!Number.isSafeInteger(pid) || pid <= 0 || opts.signal.aborted) throw new Error();
        resolve(pid);
      } catch { cancel(); fail(); }
    });
  });
}

function desktopRefs(tree) {
  const items = [];
  function walk(node) {
    if (!node) return;
    if (node.ref_id) items.push({ ref: node.ref_id, role: node.role, name: String(node.name ?? "").slice(0, 180),
      secure: node.states?.includes("secure") === true, actions: node.available_actions ?? [] });
    for (const child of node.children ?? []) walk(child);
  }
  walk(tree);
  return items;
}

function browserExecutable() {
  const candidates = process.platform === "win32"
    ? [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean).flatMap(base =>
        [path.join(base,"Google/Chrome/Application/chrome.exe"), path.join(base,"Microsoft/Edge/Application/msedge.exe")])
    : ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/usr/bin/google-chrome", "/usr/bin/chromium"];
  return candidates.find(file => existsSync(file));
}

function makeNative(tools, stateDir) {
  const win = process.platform === "win32";
  const binary = name => path.join(tools, name + (win ? ".exe" : ""));
  // Start with OS facilities only. Provider credentials and user CLI configuration do not belong in controlled apps.
  const env = {};
  for (const key of ["SystemRoot","WINDIR","COMSPEC","PATH","PATHEXT","TEMP","TMP","TMPDIR","HOME","USERPROFILE","LOCALAPPDATA","APPDATA","DISPLAY","WAYLAND_DISPLAY","XDG_RUNTIME_DIR","DBUS_SESSION_BUS_ADDRESS","LANG"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return async (session, op, request, signal) => {
    const cwd = path.join(stateDir,session.id);
    mkdirSync(cwd, { recursive: true, mode: 0o700 });
    const opts = { env: { ...env, AGENT_DESKTOP_HOME: cwd }, cwd, signal };
    if (session.kind === "desktop") {
      const desk = "ChronosPC-" + session.id;
      const cli = binary("agent-desktop");
      const desktop = (args, stdin) => win && session.private
        ? execute(binary("private-desktop"), [desk, "run", cli, ...args], { ...opts, stdin })
        : execute(cli, args, { ...opts, stdin });
      if (op === "open") {
        if (win) {
          const exe = path.isAbsolute(session.target) ? session.target : path.join(process.env.SystemRoot, "System32", session.target);
          session.pid = await ownWindow(binary("private-desktop"),desk,exe,session,opts);
          session.app = path.basename(exe);
        } else {
          const result = await desktop(["launch", session.target]);
          session.app = result.data.app;
        }
        return;
      }
      if (op === "snapshot") {
        const reply = await desktop(["snapshot","--app",session.app,"-i", ...(request.surface === "menu" ? ["--surface","menu"] : []), ...(request.window ? ["--window-id",request.window] : [])]);
        return desktopRefs(reply.data.tree);
      }
      if (op === "click" || op === "expand") await desktop([op, request.ref]);
      if (op === "fill") await desktop(["set-value",request.ref,"--stdin"],request.value);
      return;
    }

    const config = path.join(cwd,"browser.json");
    if (!existsSync(config)) writeFileSync(config, "{}", { mode: 0o600 });
    const chrome = browserExecutable();
    const args = ["--config",config,"--session",session.id,"--allowed-domains", session.host, "--json"];
    if (chrome) args.push("--executable-path",chrome);
    const exec = (extra,stdin) => execute(binary("agent-browser"), [...args,...extra], {
      ...opts, stdin, env: { ...env, AGENT_BROWSER_IDLE_TIMEOUT_MS: "60000", AGENT_BROWSER_SOCKET_DIR: path.join(cwd, "socket") },
    });
    if (op === "open") {
      await exec(["open",request.target]);
      if (new URL((await exec(["get","url"])).data.url).origin !== session.target) throw new Error("Сайт перешёл на другой адрес.");
      return;
    }
    if (op === "close") return void await exec(["close"]);
    if (new URL((await exec(["get","url"])).data.url).origin !== session.target) throw new Error("Сайт перешёл на другой адрес.");
    if (op === "snapshot") {
      const result = await exec(["snapshot","-i"]);
      return Object.entries(result.data.refs ?? {}).map(([ref, value]) => ({
        ref: "@" + ref.replace(/^@/,""), role: value.role, name: String(value.name ?? "").slice(0,180),
      }));
    }
    if (op === "click") return void await exec(["click",request.ref]);
    if (op === "field") {
      const type = (await exec(["get","attr",request.ref,"type"])).data.value;
      const autocomplete = (await exec(["get","attr",request.ref,"autocomplete"])).data.value;
      return !["text","email","search","url","tel","number"].includes(type) || /password|cc-|one-time-code/i.test(autocomplete ?? "");
    }
    if (op === "fill") {
      const result = await exec(["batch","--bail","--omit-command"], JSON.stringify([["fill",request.ref,request.value]]));
      if (!Array.isArray(result) || !result.length || result[0].success !== true) throw new Error("Поле не заполнено.");
    }
  };
}

module.exports = { makeNative, desktopRefs };

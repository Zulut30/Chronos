import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

const resources = process.env.CHRONOS_TEST_RESOURCES ?? path.resolve(import.meta.dirname, "../../services");
const entries = [
  ["tasks-service","TASKS","/api/health"], ["skills-manager","SKILLS","/api/health"],
  ["files-service","FILES","/health"], ["studio-service","STUDIO","/api/health"],
  ["integrations-service","INTEGRATIONS","/api/health"], ["mcp-manager","MCP","/api/health"],
  ["olympus-hub","HUB","/mcp/oly-web"],
];

async function listen() {
  const socket = net.createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  return socket;
}

async function run(shared, measure) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "chronos-host-"));
  const children = [], sockets = [];
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^OLY_|API_KEY$/.test(key)) delete env[key];
  Object.assign(env, { HOME:tmp, USERPROFILE:tmp, CHRONOS_T3_HOME:tmp, CHRONOS_SERVICES_DATA:tmp,
    CODEX_HOME:path.join(tmp,"codex"), OLY_FILES_DEST:path.join(tmp,"downloads") });
  fs.mkdirSync(path.join(tmp, "logs", "services"), { recursive:true });
  const urls = new Map();
  async function close(socket) {
    if (socket.listening) await new Promise(resolve => socket.close(resolve));
  }
  function start(entry, ipc) {
    const child = spawn(process.execPath, [path.join(resources,entry)], { env, cwd:tmp, windowsHide:true,
      stdio: ipc ? ["ignore","ignore","inherit","ipc"] : "ignore" });
    children.push({ child, exited:once(child, "exit") });
    return child;
  }
  async function check(name) {
    for (let i=0;i<120;i++) {
      try {
        const res = await fetch(urls.get(name), {signal:AbortSignal.timeout(500)});
        const status = res.status;
        await res.arrayBuffer();
        if (status === (name === "olympus-hub" ? 401 : 200)) return;
      } catch {}
      await delay(50);
    }
    throw Error("Service did not start: " + name);
  }
  try {
    for (const [name,key,health] of entries) {
      const socket = await listen();
      sockets.push(socket);
      const port = socket.address().port;
      env["OLY_"+key+"_PORT"] = String(port);
      urls.set(name, "http://127.0.0.1:"+port+health);
    }
    // Keep the first worker's port occupied to reproduce its process.exit(1).
    for (const socket of sockets.slice(shared && !measure ? 1 : 0)) await close(socket);
    const host = shared ? start("host.mjs", true) : undefined;
    const failed = shared && !measure ? once(host, "message", {signal:AbortSignal.timeout(8000)}) : null;
    for (const [name] of entries) {
      if (host) host.send(name); else start(name+"/server.mjs", false);
    }
    if (failed) {
      assert.equal((await failed)[0], "tasks-service");
      await check("studio-service");
      await close(sockets[0]);
      host.send("tasks-service");
    }
    await Promise.all(entries.map(([name]) => check(name)));
    if (measure) {
      await delay(1000);
      const ids = children.map(p => p.child.pid).join(",");
      const command = "Get-Process -Id "+ids+" | Select-Object WorkingSet64,PrivateMemorySize64,CPU | ConvertTo-Json -Compress";
      const sample = () => [JSON.parse(execFileSync("powershell.exe", ["-NoProfile","-Command",command],
        {encoding:"utf8",windowsHide:true}))].flat();
      const before = sample();
      for (let i=0;i<10;i++) await Promise.all(entries.map(([name]) => check(name)));
      const after = sample(), sum = (sample, key) => sample.reduce((n,row) => n+row[key],0);
      console.log(JSON.stringify({ shared, processes:after.length, rssMiB:sum(after,"WorkingSet64")/1048576,
        privateMiB:sum(after,"PrivateMemorySize64")/1048576, cpuSeconds:sum(after,"CPU")-sum(before,"CPU") }));
    }
    if (host) host.disconnect();
  } finally {
    for (const socket of sockets) await close(socket);
    for (const {child,exited} of children) {
      if (child.connected || (!shared && child.exitCode===null)) child.kill();
      await exited;
    }
    fs.rmSync(tmp, {recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
}
test("host isolates worker exits and serves all seven ports", {timeout:30000}, () => run(true,false));
if (process.env.CHRONOS_BENCH_SIDECARS === "1") {
  test("Windows sidecar working set, private commit and CPU", async () => {
    for (const mode of [false,true,true,false,false,true]) await run(mode,true);
  });
}

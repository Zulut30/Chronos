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

async function waitTcpPort(port, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const sock = net.connect({ host: "127.0.0.1", port });
      sock.once("connect", () => {
        sock.destroy();
        resolve(true);
      });
      sock.once("error", () => {
        sock.destroy();
        resolve(false);
      });
    });
    if (ok) return;
    await delay(25);
  }
  throw Error("Port did not start listening: " + port);
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
    if (host && !measure) {
      const id = "12345678-1234-4234-8234-123456789abc";
      host.once("message", msg => {
        assert.equal(msg.kind,"artifact-open");
        assert.equal(msg.id,id);
        host.send({kind:"artifact-delivered",request:msg.request,delivered:true});
      });
      const response = await fetch(new URL("/api/open",urls.get("studio-service")),{
        method:"POST",headers:{"content-type":"application/json","x-oly":"1"},
        body:JSON.stringify({artifact:id,confirmDelete:false}),
      });
      assert.deepEqual(await response.json(),{ok:true,delivered:1});
    }
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
test("host starts workers on demand, keeps Studio bridge alive across idle sleep, and reports public port", {timeout:30000}, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "chronos-host-lazy-"));
  const sockets = [];
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^OLY_|API_KEY$/.test(key)) delete env[key];
  Object.assign(env, {
    HOME: tmp, USERPROFILE: tmp, CHRONOS_T3_HOME: tmp, CHRONOS_SERVICES_DATA: tmp,
    CODEX_HOME: path.join(tmp, "codex"), OLY_FILES_DEST: path.join(tmp, "downloads"),
    CHRONOS_SERVICE_IDLE_MS: "400",
  });
  fs.mkdirSync(path.join(tmp, "logs", "services"), { recursive: true });
  const ports = {};
  for (const [name, key] of entries) {
    const sock = await listen();
    sockets.push(sock);
    ports[name] = sock.address().port;
    env["OLY_" + key + "_PORT"] = String(ports[name]);
  }
  for (const sock of sockets) await new Promise(r => sock.close(r));
  const host = spawn(process.execPath, [path.join(resources, "host.mjs")], {
    env, cwd: tmp, windowsHide: true, stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  const exited = once(host, "exit");
  const bridgeAbort = new AbortController();
  try {
    for (const [name] of entries) host.send(name);
    await Promise.all(entries.map(([name]) => waitTcpPort(ports[name])));
    // Open Studio SSE bridge + send CORS preflight & context while studio-service is asleep.
    const studioBase = "http://127.0.0.1:" + ports["studio-service"];
    const bridgeRes = await fetch(studioBase + "/api/bridge", { signal: bridgeAbort.signal });
    assert.equal(bridgeRes.status, 200);
    const reader = bridgeRes.body.getReader();
    const decoder = new TextDecoder();
    let sseBuf = "";
    const readUntil = async (needle) => {
      const until = Date.now() + 8000;
      while (!sseBuf.includes(needle) && Date.now() < until) {
        const { value, done } = await reader.read();
        if (done) break;
        sseBuf += decoder.decode(value, { stream: true });
      }
      assert.ok(sseBuf.includes(needle), "Expected SSE to contain " + needle + ", got: " + sseBuf);
    };
    await readUntil("event: hello");
    const optRes = await fetch(studioBase + "/api/context", { method: "OPTIONS", headers: { origin: "t3code://app" } });
    assert.equal(optRes.status, 204);
    const ctxPost = await fetch(studioBase + "/api/context", {
      method: "POST",
      headers: { "content-type": "application/json", "x-oly": "1", origin: "t3code://app" },
      body: JSON.stringify({ threadId: "t-lazy-1", cwd: tmp }),
    });
    assert.equal(ctxPost.status, 200);
    const studioLog = path.join(tmp, "logs", "services", "studio-service.log");
    const readLog = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");
    assert.equal(readLog(studioLog).includes("T3 Studio on"), false, "studio-service should still be asleep");

    // First real request wakes studio-service, replays buffered context, and delivers SSE open event.
    const ctxGet = await (await fetch(studioBase + "/api/context")).json();
    assert.equal(ctxGet.threadId, "t-lazy-1");
    assert.equal(ctxGet.cwd, tmp);
    const openRes = await (await fetch(studioBase + "/api/open", {
      method: "POST",
      headers: { "content-type": "application/json", "x-oly": "1" },
      body: JSON.stringify({ hub: "boards" }),
    })).json();
    assert.equal(openRes.ok, true);
    assert.equal(openRes.delivered, 1);
    await readUntil("event: open");

    // Health endpoint reports the public port, not the internal worker port.
    const skillsHealth = await (await fetch("http://127.0.0.1:" + ports["skills-manager"] + "/api/health")).json();
    assert.equal(skillsHealth.ok, true);
    assert.equal(skillsHealth.port, ports["skills-manager"]);

    // Wait for idle sleep, verify sleep logged, and verify transparent re-wake.
    const sleepDeadline = Date.now() + 2500;
    while (!readLog(studioLog).includes("Sleeping idle worker") && Date.now() < sleepDeadline) {
      await delay(50);
    }
    assert.ok(readLog(studioLog).includes("Sleeping idle worker"), "studio-service should sleep when idle");
    const wakeHealth = await (await fetch(studioBase + "/api/health")).json();
    assert.equal(wakeHealth.ok, true);
    assert.equal(wakeHealth.port, ports["studio-service"]);
    assert.equal(wakeHealth.bridge, 1);

    bridgeAbort.abort();
    host.disconnect();
  } finally {
    bridgeAbort.abort();
    if (host.exitCode === null) host.kill();
    await exited;
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
test("first concurrent requests and preflight to sleeping services wait for readiness and preserve CORS headers", {timeout:30000}, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "chronos-host-cors-"));
  const sockets = [];
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^OLY_|API_KEY$/.test(key)) delete env[key];
  Object.assign(env, {
    HOME: tmp, USERPROFILE: tmp, CHRONOS_T3_HOME: tmp, CHRONOS_SERVICES_DATA: tmp,
    CODEX_HOME: path.join(tmp, "codex"), OLY_FILES_DEST: path.join(tmp, "downloads"),
  });
  fs.mkdirSync(path.join(tmp, "logs", "services"), { recursive: true });
  const ports = {};
  for (const [name, key] of entries) {
    const sock = await listen();
    sockets.push(sock);
    ports[name] = sock.address().port;
    env["OLY_" + key + "_PORT"] = String(ports[name]);
  }
  for (const sock of sockets) await new Promise(r => sock.close(r));
  const host = spawn(process.execPath, [path.join(resources, "host.mjs")], {
    env, cwd: tmp, windowsHide: true, stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  const exited = once(host, "exit");
  try {
    host.send("tasks-service");
    host.send("integrations-service");
    await Promise.all([
      waitTcpPort(ports["tasks-service"]),
      waitTcpPort(ports["integrations-service"]),
    ]);

    // Reproduce 30-tasks.js home screen loadAll(): 3 concurrent requests to a sleeping tasks-service.
    const tasksBase = "http://127.0.0.1:" + ports["tasks-service"];
    const responses = await Promise.all([
      fetch(tasksBase + "/api/projects", { headers: { origin: "t3code://app" } }),
      fetch(tasksBase + "/api/groups", { headers: { origin: "t3code://app" } }),
      fetch(tasksBase + "/api/tasks", { headers: { origin: "t3code://app" } }),
    ]);
    for (const res of responses) {
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("access-control-allow-origin"), "t3code://app");
      assert.equal(res.headers.get("vary"), "Origin");
      assert.ok(Array.isArray(await res.json()));
    }

    // Preflight OPTIONS to a sleeping service preserves CORS preflight headers.
    const optRes = await fetch("http://127.0.0.1:" + ports["integrations-service"] + "/api/keys", {
      method: "OPTIONS",
      headers: { origin: "t3code://app", "access-control-request-method": "POST", "access-control-request-headers": "content-type, x-oly" },
    });
    assert.equal(optRes.status, 204);
    assert.equal(optRes.headers.get("access-control-allow-origin"), "t3code://app");
    assert.ok(optRes.headers.get("access-control-allow-methods")?.includes("POST"));
    assert.ok(optRes.headers.get("access-control-allow-headers")?.toLowerCase().includes("x-oly"));

    host.disconnect();
  } finally {
    if (host.exitCode === null) host.kill();
    await exited;
  }

  // Proxy startup failure (503) still includes CORS headers for trusted origins and omits them for untrusted origins.
  const failSock = await listen();
  const failPort = failSock.address().port;
  await new Promise(r => failSock.close(r));
  const failHost = spawn(process.execPath, [path.join(resources, "host.mjs")], {
    env: { ...env, OLY_TASKS_PORT: String(failPort), CHRONOS_SERVICE_START_TIMEOUT_MS: "1" },
    cwd: tmp, windowsHide: true, stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  const failExited = once(failHost, "exit");
  try {
    failHost.send("tasks-service");
    await waitTcpPort(failPort);
    const trustedErr = await fetch("http://127.0.0.1:" + failPort + "/api/tasks", {
      headers: { origin: "t3code://app" },
    });
    assert.equal(trustedErr.status, 503);
    assert.equal(trustedErr.headers.get("access-control-allow-origin"), "t3code://app");
    assert.equal(trustedErr.headers.get("vary"), "Origin");
    const untrustedErr = await fetch("http://127.0.0.1:" + failPort + "/api/tasks", {
      headers: { origin: "https://untrusted.invalid" },
    });
    assert.equal(untrustedErr.status, 503);
    assert.equal(untrustedErr.headers.get("access-control-allow-origin"), null);
    failHost.disconnect();
  } finally {
    if (failHost.exitCode === null) failHost.kill();
    await failExited;
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
if (process.env.CHRONOS_BENCH_SIDECARS === "1") {
  test("Windows sidecar working set, private commit and CPU", async () => {
    for (const mode of [false,true,true,false,false,true]) await run(mode,true);
  });
}

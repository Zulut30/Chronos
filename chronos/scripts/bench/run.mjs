// Node 24+. Windows packaged Chronos, no install/build or provider credentials required.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { createSandbox } from "./sandbox.mjs";
import { connectCdp, rpcClient } from "./client.mjs";

const [distribution, count, output, frameArg = "80", intervalArg = "125"] = process.argv.slice(2);
const n = Number(count), frames = Number(frameArg), interval = Number(intervalArg);
if (!distribution || !output || ![n, frames, interval].every(v => Number.isSafeInteger(v) && v > 0)) {
  throw Error("Usage: node run.mjs <unpacked Chronos directory> <N> <result.json> [chunks] [interval ms]");
}
const exe = resolve(distribution, "Chronos.exe");
const entry = resolve(distribution, "resources/server.asar/apps/server/dist/bin.mjs");
const chrome = process.env.BENCH_CHROME ?? join(process.env.ProgramFiles, "Google/Chrome/Application/chrome.exe");
assert(existsSync(exe) && existsSync(chrome));
const { root, home, userdata, work, profile, env, run, start, wait, port, modelSelection, close } = createSandbox(frames, interval);
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const serverEnv = { ...env, ELECTRON_RUN_AS_NODE: "1", CHRONOS_BENCH_ROOT: root };
if (process.env.BENCH_TRACE_LEVEL) serverEnv.T3CODE_TRACE_MIN_LEVEL = process.env.BENCH_TRACE_LEVEL;
async function post(path, body, headers = {}) {
  const res = await fetch(origin + path, { method: "POST", headers: { "content-type": "application/json", ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw Error(path + ": HTTP " + res.status + " " + (await res.text()).slice(0, 320));
  return res;
}
function disk() {
  const sum = (dir, regex) => readdirSync(dir).filter(f => regex.test(f)).reduce((v,f) => v + statSync(join(dir,f)).size, 0);
  return { db: sum(userdata, /^statev2\.sqlite(?:-wal|-shm)?$/), trace: sum(join(userdata, "logs"), /^server\.trace\.ndjson(?:\.\d+)?$/) };
}
// Read a short, consistent snapshot outside the timed interval. No checkpoint:
// a checkpoint here would change the physical high-water mark being measured.
function databaseSample() {
  const file = join(userdata, "statev2.sqlite");
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout=5000; BEGIN");
    const scalar = (query) => Object.values(db.prepare(query).get())[0];
    const sizes = Object.fromEntries(["","-wal","-shm"].map(ext => [ext || "main", existsSync(file+ext) ? statSync(file+ext).size : 0]));
    return { sizes, pageSize:scalar("PRAGMA page_size"), pages:scalar("PRAGMA page_count"),
      freePages:scalar("PRAGMA freelist_count"),
      events:db.prepare("SELECT event_type, count(*) AS rows, sum(length(CAST(payload_json AS BLOB))) AS bytes FROM orchestration_events GROUP BY event_type ORDER BY event_type").all() };
  } finally { db.close(); }
}
const listen = await port(), origin = "http://127.0.0.1:" + listen;
const proj = crypto.randomUUID();
const ids = Array.from({ length: n }, () => crypto.randomUUID());
let cdp, rpc;
try {
  const server = start(exe, ["--require", join(import.meta.dirname, "probe.cjs"), entry, "serve", "--base-dir", home, "--port", String(listen), "--host","127.0.0.1","--no-browser"], serverEnv);
  const state = await wait("isolated server", () => existsSync(join(userdata, "server-runtime.json")) && json(join(userdata, "server-runtime.json")));
  assert.equal(state.pid, server.pid);
  assert.equal(state.origin, origin);
  const bearer = run(exe, [entry,"auth","session","issue","--token-only","--label","bench"], serverEnv).trim();
  const auth = { authorization: "Bearer " + bearer };
  const { credential } = JSON.parse(run(exe, [entry,"auth","pairing","create","--json"], serverEnv));
  const browserSession = await post("/api/auth/browser-session", { credential });
  const cookies = browserSession.headers.getSetCookie().map(v => v.split(";")[0]).filter(v => !v.endsWith("="));
  assert(cookies.length);
  await post("/api/projects/mutate", { type:"project.create", commandId:crypto.randomUUID(), projectId:proj, title:"Bench", workspaceRoot:work }, auth);
  const { ticket } = await (await post("/api/auth/websocket-ticket/rpc", null, auth)).json();
  rpc = await rpcClient(origin.replace("http:", "ws:") + "/ws?orchestrationProtocol=2&wsTicket=" + encodeURIComponent(ticket));
  const environment = (await (await fetch(origin + "/.well-known/t3/environment")).json()).environmentId;
  assert(environment);
  console.log("Server ready", state.pid);
  const debugPort = await port();
  const browser = start(chrome, ["--headless=new","--no-first-run","--no-default-browser-check","--disable-background-networking",
    "--disable-extensions","--disable-component-update","--disable-sync","--renderer-process-limit=1",
    ...(process.env.BENCH_V8_SIZE === "1" ? ["--js-flags=--optimize-for-size"] : []),
    "--disable-features=SpareRendererForSitePerProcess","--remote-debugging-port=" + debugPort,"--user-data-dir="+profile,
    "--proxy-server=127.0.0.1:9","--proxy-bypass-list=<-loopback>;127.0.0.1:"+listen,"about:blank"], env);
  const endpoint = await wait("private CDP", async () => {
    try { return (await (await fetch("http://127.0.0.1:"+debugPort+"/json/version")).json()).webSocketDebuggerUrl; }
    catch { return false; }
  }, 15000).catch(error => { throw Error(error.message + " " + browser.errors); });
  cdp = await connectCdp(endpoint);
  const { targetInfos } = await cdp.call("Target.getTargets");
  const { sessionId } = await cdp.call("Target.attachToTarget", { targetId: targetInfos.find(t => t.type === "page").targetId, flatten: true });
  const page = (method, args) => cdp.call(method, args, sessionId);
  await page("Network.enable");
  await page("Network.setBlockedURLs", { urls: Array.from({length:8}, (_,i) => "*:" + (4517+i) + "/*") });
  await cdp.call("Storage.setCookies", { cookies: cookies.map(cookie => {
    const split = cookie.indexOf("=");
    return { name: cookie.slice(0,split), value: cookie.slice(split+1), url: origin };
  }) });
  const here = () => page("Runtime.evaluate", { expression: "document.body.innerText", returnByValue:true }).then(v => v.result.value ?? "");
  // The selected thread is opened after launch. Navigating twice races renderer replacement.
  const texts = new Map(ids.map(id => [id, new Map()]));
  const complete = new Set();
  const ready = new Set();
  const latency = [];
  const onEvent = (id, item) => {
    if (item.kind === "synchronized") ready.add(id);
    if (item.kind !== "event") return;
    const { type, payload } = item.event;
    if (type === "run.updated" && payload.status === "completed") complete.add(id);
    if (type === "run.updated" && ["failed","interrupted","cancelled"].includes(payload.status)) throw Error("Run " + payload.status);
    for (const m of (payload.text ?? "").matchAll(/MARK_([a-f0-9-]+)_(\d+)_(\d+)/g)) {
      assert.equal(m[1], id);
      const seen = texts.get(id), k = Number(m[2]);
      if (!seen.has(k)) { seen.set(k, true); latency.push(Date.now() - Number(m[3])); }
    }
  };
  console.log("Renderer connected");
  await Promise.all(ids.map(threadId => rpc.call("orchestration.launchThread", { commandId: crypto.randomUUID(),
    threadId, projectId: proj, title: "Bench " + threadId, generateTitle:false, modelSelection, runtimeMode:"approval-required",
    interactionMode:"default", workspaceStrategy:{type:"root"}, initialMessage:{text:"bench-"+threadId,attachments:[]} })));
  for (const threadId of ids) rpc.stream("orchestration.subscribeThread", { threadId, requestCompletionMarker:true, acceptBoundedSnapshot:true }, item => onEvent(threadId, item));
  await page("Page.navigate", { url: origin + "/" + environment + "/" + ids[0] });
  await wait("agents and subscriptions", () => { rpc.check(); return ready.size === n && ids.every(id => existsSync(join(root,id+".ready"))); });
  console.log("Agents at start barrier");
  await wait("visible thread", async () => (await here()).includes("bench-"+ids[0]));
  async function renderer(measureMemory) {
    const { processInfo } = await cdp.call("SystemInfo.getProcessInfo");
    const time = performance.now();
    const group = processInfo.filter(p => p.type.toLowerCase() === "renderer");
    assert(group.length);
    const pids = group.map(p => Number(p.id));
    assert(pids.every(Number.isSafeInteger));
    const rss = measureMemory ? Number(execFileSync("powershell.exe", ["-NoProfile","-Command",
      "(Get-Process -Id " + pids.join(",") + " | Measure-Object WorkingSet64 -Sum).Sum"], { encoding:"utf8", windowsHide:true }).trim()) : 0;
    const priv = measureMemory ? Number(execFileSync("powershell.exe", ["-NoProfile","-Command",
      "(Get-Process -Id " + pids.join(",") + " | Measure-Object PrivateMemorySize64 -Sum).Sum"], { encoding:"utf8", windowsHide:true }).trim()) : 0;
    if (measureMemory) assert(rss > 0);
    return { time, cpu: group.reduce((v,p) => v+p.cpuTime,0), rss, priv, pids };
  }
  async function probe(name) {
    const marker = join(root, "probe-"+name);
    writeFileSync(marker, "");
    return await wait("server probe "+name, () => existsSync(marker+".json") && json(marker+".json"), 6000);
  }
  const databaseBefore = databaseSample();
  const before = await renderer(false), diskBefore = disk(), begin = await probe("start");
  if (process.env.BENCH_FRAME_TIMES === "1") {
    await page("Runtime.evaluate", { expression: `window.benchFrames=[]; requestAnimationFrame(function frame(now){
      if(!window.benchFrames)return; window.benchFrames.push(now);requestAnimationFrame(frame);
    })` });
  }
  writeFileSync(join(root, "go"), "");
  await wait("terminal events", () => { rpc.check(); return complete.size === n; }, 120000);
  const end = await probe("end"), after = await renderer(true);
  const serverPrivateBytes = Number(execFileSync("powershell.exe", ["-NoProfile","-Command",
    "(Get-Process -Id " + server.pid + ").PrivateMemorySize64"], { encoding:"utf8", windowsHide:true }).trim());
  let frameP95Ms;
  if (process.env.BENCH_FRAME_TIMES === "1") {
    const sample = await page("Runtime.evaluate", {expression:`(()=>{
      const times=window.benchFrames;window.benchFrames=null;
      const gaps=times.slice(1).map((t,i)=>t-times[i]).sort((a,b)=>a-b);
      return gaps[Math.ceil(gaps.length*0.95)-1];
    })()`,returnByValue:true});
    frameP95Ms = sample.result.value;
    assert(frameP95Ms > 0);
  }
  assert.equal(end.pid, server.pid);
  assert.deepEqual(after.pids.sort(), before.pids.sort());
  await sleep(1300); // allow the final one-second trace batch to reach disk
  const diskAfter = disk();
  for (const id of ids) {
    const final = await rpc.call("orchestration.getThreadProjection", { threadId:id });
    const assistant = final.turnItems.filter(i => i.type === "assistant_message").map(i => i.text).join("").trim();
    assert.equal(assistant, readFileSync(join(root,id+".txt"),"utf8").trim());
    assert.equal(texts.get(id).size, frames);
  }
  await wait("visible final marker", async () => (await here()).includes("MARK_"+ids[0]+"_"+(frames-1)+"_"));
  latency.sort((a,b) => a-b);
  const elapsed = end.time - begin.time;
  const result = { n, frames, interval, traceLevel: serverEnv.T3CODE_TRACE_MIN_LEVEL ?? "default",
    serverVersion:state.serverVersion, sampleCount:latency.length,
    elapsedMs:elapsed, eventP95Ms:latency[Math.ceil(latency.length*0.95)-1], lagP95Ms:Math.max(0,end.p95),
    lagSamples:end.count, serverCpuPct:(end.cpu-begin.cpu)/elapsed/10, serverRssMiB:end.rss/1048576,
    serverPrivateMiB:serverPrivateBytes/1048576,
    serverMemoryMiB: end.memory ? Object.fromEntries(Object.entries(end.memory).map(([k,v]) => [k, v/1048576])) : undefined,
    rendererCpuPct:(after.cpu-before.cpu)*100000/(after.time-before.time), rendererRssMiB:after.rss/1048576,
    rendererPrivateMiB:after.priv/1048576,
    dbGrowthKiB:(diskAfter.db-diskBefore.db)/1024, traceGrowthKiB:(diskAfter.trace-diskBefore.trace)/1024,
    databaseBefore, databaseAfter:databaseSample(), frameP95Ms, optimizeForSize:process.env.BENCH_V8_SIZE === "1",
    completed:complete.size, rendererCount:after.pids.length, verifiedTexts:n, visibleFinal:true };
  writeFileSync(resolve(output), JSON.stringify(result,null,2)+"\n");
  console.log(result);
} finally {
  rpc?.close();
  cdp?.close();
  close();
}

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
const n = Number(count), frames = 480, interval = 85;
assert(["web", "desktop"].includes(mode) && [0,8,16].includes(n) && output);
if (mode === "desktop") assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted", "Fixed service ports require a disposable VM");
const exe = resolve(distribution, "Chronos.exe");
const entry = resolve(distribution, "resources/server.asar/apps/server/dist/bin.mjs");
const sb = createSandbox(frames, interval, "code");
const { port, run, start, wait, env, root, home, userdata, work, profile, modelSelection } = sb;
const nodeEnv = { ...env, ELECTRON_RUN_AS_NODE: "1" };
const listen = await port(), debug = await port(), origin = "http://127.0.0.1:" + listen;
const proj = crypto.randomUUID();
const targets = [crypto.randomUUID(), crypto.randomUUID()];
const ids = Array.from({ length:n }, () => crypto.randomUUID());
const stateFile = join(userdata, "server-runtime.json");
let rpc, cdp, evaluate;
try {
  let server;
  if (mode === "desktop") {
    start(exe, ["--remote-debugging-port=" + debug, "--user-data-dir="+profile, "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling"], { ...env, T3CODE_PORT: String(listen) });
  } else {
    server = start(exe, [entry, "serve", "--base-dir", home, "--port", String(listen), "--host","127.0.0.1","--no-browser"], nodeEnv);
    start(process.env.BENCH_CHROME ?? join(process.env.ProgramFiles, "Google/Chrome/Application/chrome.exe"), [
      "--headless", "--window-size=1400,900", "--remote-debugging-port="+debug, "--user-data-dir="+profile, "--no-first-run",
      "--disable-extensions","--disable-background-networking","--renderer-process-limit=1","--disable-features=SpareRendererForSitePerProcess",
      "--proxy-server=127.0.0.1:9", "--proxy-bypass-list=<-loopback>;127.0.0.1:"+listen, "about:blank"], env);
  }
  const state = await wait("private server", () => existsSync(stateFile) && JSON.parse(readFileSync(stateFile,"utf8")));
  assert.equal(state.origin, origin);
  if (server) assert.equal(state.pid, server.pid);
  const getCdp = async path => (await fetch("http://127.0.0.1:"+debug+path)).json();
  const endpoint = await wait("CDP", () => getCdp("/json/version").catch(()=>false));
  cdp = await connectCdp(endpoint.webSocketDebuggerUrl);
  const target = await wait("Chronos page", async () => (await getCdp("/json/list")).find(
    t => t.type === "page" && (mode === "web" || t.url.startsWith("t3code://app"))));
  const { sessionId } = await cdp.call("Target.attachToTarget", { targetId:target.id, flatten:true });
  const page = (method, params) => cdp.call(method,params,sessionId);
  evaluate = async expression => {
    const r = await page("Runtime.evaluate", { expression, awaitPromise:true, returnByValue:true });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  await page("Emulation.setDeviceMetricsOverride", { width:1400,height:900,deviceScaleFactor:1,mobile:false });
  await page("Page.bringToFront");
  await page("Performance.enable");
  await page("Network.enable");
  const detailIds = new Set();
  cdp.listen(event => {
    if (event.sessionId !== sessionId || event.method !== "Network.webSocketFrameSent") return;
    try {
      const data = JSON.parse(event.params.response.payloadData);
      for (const m of [data].flat()) if (m.tag === "orchestration.subscribeThread") detailIds.add(m.payload.threadId);
    } catch { /* Non-RPC socket */ }
  });
  async function post(path, body, token) {
    const r = await fetch(origin+path,{method:"POST",headers:{"content-type":"application/json",
      ...(token ? {authorization:"Bearer "+token} : {})}, ...(body ? {body:JSON.stringify(body)}:{})});
    assert(r.ok, path+" "+r.status); return r;
  }
  const bearer = run(exe,[entry,"auth","session","issue","--token-only","--label","ui-bench"],nodeEnv).trim();
  if (mode === "web") {
    await page("Network.setBlockedURLs",{urls:Array.from({length:8},(_,i)=>"*:"+(4517+i)+"/*")});
    const {credential} = JSON.parse(run(exe,[entry,"auth","pairing","create","--json"],nodeEnv));
    const cookies = (await post("/api/auth/browser-session",{credential})).headers.getSetCookie();
    for (const cookie of cookies) {
      const [pair] = cookie.split(";"), ix = pair.indexOf("=");
      if (pair.slice(ix+1)) await page("Network.setCookie",{name:pair.slice(0,ix),value:pair.slice(ix+1),url:origin});
    }
  }
  await post("/api/projects/mutate",{type:"project.create", commandId:crypto.randomUUID(), projectId:proj, title:"Bench", workspaceRoot:work},bearer);
  const {ticket} = await (await post("/api/auth/websocket-ticket/rpc",null,bearer)).json();
  rpc = await rpcClient(origin.replace("http:","ws:")+"/ws?orchestrationProtocol=2&wsTicket="+encodeURIComponent(ticket));
  const environment = (await (await fetch(origin+"/.well-known/t3/environment")).json()).environmentId;
  const common = {projectId:proj,modelSelection,runtimeMode:"approval-required",interactionMode:"default"};
  console.log("Seeding",mode,n);
  for (let i=0; i<300; i+=8) {
    await Promise.all(Array.from({length:Math.min(8,300-i)},(_,j)=>rpc.call("orchestration.dispatchCommand",{
      ...common,createdBy:"user",creationSource:"web",branch:null,worktreePath:null,type:"thread.create",commandId:crypto.randomUUID(),threadId:crypto.randomUUID(),title:"Fixture "+(i+j) })));
  }
  const launch = (id,seed) => rpc.call("orchestration.launchThread",{...common,commandId:crypto.randomUUID(),threadId:id,
    title:"Bench "+id,generateTitle:false,workspaceStrategy:{type:"root"},
    initialMessage:{text:(seed?"SEED_HISTORY ":"")+"bench-"+id,attachments:[]}});
  const projection = id => rpc.call("orchestration.getThreadProjection",{threadId:id});
  const finished = async id => (await projection(id)).runs.at(-1)?.status === "completed";
  await Promise.all(targets.map(id=>launch(id,true)));
  await wait("seeded histories", async () => (await Promise.all(targets.map(finished))).every(Boolean));
  const route = id => "/"+environment+"/"+id;
  if (mode === "web") await page("Page.navigate",{url:origin+route(targets[1])});
  const probe = readFileSync(join(import.meta.dirname,"../smoke/page-probes.js"),"utf8").trim().replace(/;$/,"");
  const navigate = async id => {
    await evaluate("window.__TSR_ROUTER__.navigate({to:"+JSON.stringify(route(id))+"}).then(()=>true)");
  };
  await wait("router",()=>evaluate("Boolean(window.__TSR_ROUTER__?.navigate)"));
  await evaluate(probe+"('dismissOnboarding')");
  await navigate(targets[1]);
  await wait("expanded rows", async () => evaluate(`(() => {
    for (const b of document.querySelectorAll('[data-testid=sidebar-project-folder] button[aria-expanded=false]')) b.click();
    return document.querySelectorAll('[data-thread-item]').length >= 300;
  })()`));
  if (action === "smoke") {
    assert.equal(mode, "desktop");
    const { runFullSmoke } = await import("./desktop-smoke.mjs");
    await runFullSmoke(debug, output, env);
  } else {
    await Promise.all(ids.map(id=>launch(id,false)));
    await wait("agent start barrier",()=>ids.every(id=>existsSync(join(root,id+".ready"))));
    const rowCount = await evaluate("document.querySelectorAll('[data-thread-item]').length");
    const perf = async () => Object.fromEntries((await page("Performance.getMetrics")).metrics.map(m=>[m.name,m.value]));
    const before = await perf();
    let traced;
    const traceDone = new Promise(resolve => { traced = resolve; });
    if (process.env.BENCH_UI_TRACE) {
      cdp.listen(e => { if(e.method === "Tracing.tracingComplete") traced(e.params.stream); });
      await cdp.call("Tracing.start",{categories:"devtools.timeline,blink.user_timing,cc,viz,input,latencyInfo",transferMode:"ReturnAsStream",streamCompression:"gzip"});
    }
    console.log("UI sample", mode, n, rowCount);
    writeFileSync(join(root,"go"),"");
    if (n) await wait("first streamed marker",async ()=>(await projection(ids[0])).turnItems.some(i=>i.type==="assistant_message" && i.text?.includes("MARK_")));
    const sample = await measureUi({page,evaluate,targets,streamingId:ids[0],navigate,wait,
      verifyStreaming:()=>assert(ids.every(id=>!existsSync(join(root,id+".txt"))),"Stream finished before input samples")});
    const after = await perf();
    if (process.env.BENCH_UI_TRACE) {
      await cdp.call("Tracing.end");
      const handle = await Promise.race([traceDone,sleep(15000).then(()=>{throw Error("Missing trace completion")})]);
      const file = createWriteStream(output+".trace.json.gz");
      for (;;) {
        const chunk = await cdp.call("IO.read",{handle,size:1048576});
        if (!file.write(Buffer.from(chunk.data,chunk.base64Encoded?"base64":"utf8"))) await once(file,"drain");
        if (chunk.eof) break;
      }
      file.end(); await once(file,"close"); await cdp.call("IO.close",{handle});
    }
    const pids = (await cdp.call("SystemInfo.getProcessInfo")).processInfo.filter(p=>p.type.toLowerCase()==="renderer").map(p=>Number(p.id));
    assert(pids.length && pids.every(Number.isSafeInteger));
    const rss = Number(execFileSync("powershell.exe",["-NoProfile","-Command",
      "(Get-Process -Id "+pids.join(",")+" | Measure-Object WorkingSet64 -Sum).Sum"],{windowsHide:true,encoding:"utf8"}));
    assert(rss > 0);
    await wait("all mocks finished writing",()=>ids.every(id=>existsSync(join(root,id+".txt"))),100000);
    await wait("all runs complete",async()=> (await Promise.all(ids.map(finished))).every(Boolean),100000);
    for (const id of [...targets,...ids]) {
      const text = (await projection(id)).turnItems.filter(i=>i.type==="assistant_message").map(i=>i.text).join("").trim();
      assert.equal(text,readFileSync(join(root,id+".txt"),"utf8").trim());
    }
    if(n) await wait("final visible marker",()=>evaluate("uiBench.hasText("+JSON.stringify("MARK_"+ids[0]+"_"+(frames-1)+"_")+")"));
    const result = {mode,n,rowCount,frames,interval,rendererCount:pids.length,rendererRssMiB:rss/1048576,
      heapMiB:after.JSHeapUsedSize/1048576,layoutMs:(after.LayoutDuration-before.LayoutDuration)*1000,
      scriptMs:(after.ScriptDuration-before.ScriptDuration)*1000,rendererAgentSubscriptions:ids.filter(id=>detailIds.has(id)).length,
      verifiedHistories:n+2,...sample};
    writeFileSync(output, JSON.stringify(result,null,2)+"\n"); console.log(result);
  }
} catch (error) {
  if(evaluate) console.error("UI at failure:",await evaluate("JSON.stringify({route:location.pathname,hash:location.hash, rows:document.querySelectorAll('[data-thread-item]').length,text:document.body.innerText.slice(0,800)})").catch(()=>null));
  throw error;
} finally {
  rpc?.close(); cdp?.close(); sb.close();
}

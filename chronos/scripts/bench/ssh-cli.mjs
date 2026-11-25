// Linux CI. Exercise the actual POSIX archive installer with a release-shaped local
// mirror of the unpublished fork, then run the same HTTP commands on both CLIs.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";

const paired = process.argv[2] === "--pair";
const [upstream, revision, archive, output] = process.argv.slice(paired ? 3 : 2);
const root=fs.mkdtempSync(path.join(os.tmpdir(),"chronos-cli-"));
const runs=[];
const home=path.join(root,"installer"),mirror=path.join(root,"releases");
fs.mkdirSync(home);
const env={PATH:process.env.PATH,HOME:home,LANG:"C.UTF-8",CI:"1",DO_NOT_TRACK:"1",T3CODE_TELEMETRY_ENABLED:"false"};
const clockTicks=Number(execFileSync("getconf",["CLK_TCK"],{encoding:"utf8"}));
function sample(pid) {
  const stat=fs.readFileSync("/proc/"+pid+"/stat","utf8").split(") ").at(-1).split(" ");
  const status=fs.readFileSync("/proc/"+pid+"/status","utf8");
  return {cpuMs:(Number(stat[11])+Number(stat[12]))*1000/clockTicks,
    rssMiB:Number(/^VmRSS:\s+(\d+)/m.exec(status)[1])/1024};
}
function traceSize(dir) {
  return fs.readdirSync(dir).filter(f=>/^server\.trace\.ndjson(?:\.\d+)?$/.test(f)).reduce((n,f)=>n+fs.statSync(path.join(dir,f)).size,0);
}
async function exercise(version, exe = path.join(home,".t3/runtime/versions",version,"t3")) {
  const fixture=fs.mkdtempSync(path.join(root,"run-")),userdata=path.join(fixture,"userdata");
  const work=path.join(fixture,"workspace");
  fs.mkdirSync(work);fs.mkdirSync(userdata);
  const childEnv={...env,HOME:fixture,T3CODE_HOME:fixture,XDG_CONFIG_HOME:path.join(fixture,"config"),XDG_DATA_HOME:path.join(fixture,"data")};
  execFileSync("git",["init","-q",work],{env:childEnv});
  const portServer=net.createServer();portServer.listen(0,"127.0.0.1");await once(portServer,"listening");
  const port=portServer.address().port;await new Promise(resolve=>portServer.close(resolve));
  const child=spawn(exe,["serve","--port",String(port),"--host","127.0.0.1","--no-browser","--base-dir",fixture],
    {env:childEnv,cwd:work,stdio:"ignore"});
  const exited=once(child,"exit");
  try {
    const runtime=path.join(userdata,"server-runtime.json");
    for(let i=0;!fs.existsSync(runtime)&&i<300&&child.exitCode===null;i++) await delay(100);
    const state=JSON.parse(fs.readFileSync(runtime,"utf8"));assert.equal(state.pid,child.pid);assert.equal(state.serverVersion,upstream);
    const token=execFileSync(exe,["auth","session","issue","--token-only","--label","bench"],{env:childEnv,encoding:"utf8"}).trim();
    const id=randomUUID();
    async function mutate(operation) {
      const res=await fetch(state.origin+"/api/projects/mutate",{method:"POST",headers:{
        "content-type":"application/json",authorization:"Bearer "+token},
        body:JSON.stringify({projectId:id,commandId:randomUUID(),...operation}),signal:AbortSignal.timeout(10000)});
      const body=await res.text();assert.equal(res.status,200,body.slice(0,200));
    }
    await mutate({type:"project.create",title:"Bench",workspaceRoot:work});
    const logs=path.join(userdata,"logs");
    await delay(1300);const before=sample(child.pid), bytes=traceSize(logs), t=performance.now();
    for(let i=0;i<80;i++) await mutate({type:"project.update",title:"Bench "+i});
    const elapsedMs=performance.now()-t;
    const active=sample(child.pid);
    await delay(1300);
    const after=sample(child.pid);
    const db=new DatabaseSync(path.join(userdata,"statev2.sqlite"),{readOnly:true});
    try {
      const {title}=db.prepare("SELECT title FROM projection_projects WHERE project_id=?").get(id);
      assert.equal(title,"Bench 79");
    } finally {db.close()}
    const result = { version, updates: 80, elapsedMs, cpuMs: after.cpuMs - before.cpuMs,
      activeCpuMs: active.cpuMs - before.cpuMs, drainCpuMs: after.cpuMs - active.cpuMs,
      rssMiB: after.rssMiB, traceBytes: traceSize(logs) - bytes };
    runs.push(result);console.log(JSON.stringify(result));
  } finally {
    if(child.exitCode===null) child.kill("SIGTERM");
    const timer=setTimeout(()=>child.kill("SIGKILL"),8000);
    try {await exited} finally {clearTimeout(timer)}
  }
}
async function compareWithUpstream() {
  const { buildRemoteT3RunnerScript } = await import("../../../packages/ssh/src/tunnel.ts");
  const release=path.join(mirror,"chronos-v"+revision);fs.mkdirSync(release,{recursive:true});
  const name=path.basename(archive);fs.copyFileSync(archive,path.join(release,name));
  const hash=createHash("sha256");for await(const chunk of fs.createReadStream(archive)) hash.update(chunk);
  fs.writeFileSync(path.join(release,"SHA256SUMS"),hash.digest("hex")+"  "+name+"\n");
  for(const version of [upstream,revision]) {
    const runner=path.join(root,"runner.sh");
    fs.writeFileSync(runner,buildRemoteT3RunnerScript({archiveVersion:version,...(version===revision?{releaseBaseUrl:pathToFileURL(mirror).href}:{})}));
    const actual=execFileSync("sh",[runner,"--version"],{cwd:root,env,encoding:"utf8",timeout:240000});
    assert.match(actual,new RegExp(upstream.replaceAll(".","\\.")));
    assert.equal(fs.readFileSync(path.join(home,".t3/runtime/versions",version,".install-complete"),"utf8").trim(),version);
  }
  for(const version of [upstream,revision,revision,upstream,upstream,revision]) await exercise(version);
}
try {
  if (paired) {
    assert.equal(process.platform, "linux");
    assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
    const binaries = { base: path.resolve(revision), head: path.resolve(archive) };
    for (const side of ["base", "head", "head", "base", "base", "head"]) {
      await exercise(side, binaries[side]);
    }
  } else {
    await compareWithUpstream();
  }
  fs.writeFileSync(output,JSON.stringify(runs,null,2)+"\n");
} finally {fs.rmSync(root,{recursive:true,force:true})}

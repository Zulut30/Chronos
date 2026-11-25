import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { makeStandbyProcess } from "../../../apps/desktop/src/chronos/snapShot/StandbyProcess.ts";

const [mode, target] = process.argv.slice(2);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "chronos-helper-"));
const env = {...process.env, HOME:tmp, USERPROFILE:tmp, T3CODE_HOME:tmp, CHRONOS_HOME:tmp,
  APPDATA:tmp, LOCALAPPDATA:tmp, ELECTRON_RUN_AS_NODE:"1"};
const ps = path.join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe");
const owned = new Set();
function start(executable,args,ipc=false) {
  const child = spawn(executable,args,{env,cwd:tmp,windowsHide:true,
    stdio:ipc?["ignore","ignore","pipe","ipc"]:["pipe","pipe","pipe"]});
  owned.add(child);
  child.once("exit",()=>owned.delete(child));
  return child;
}
function footprint(children) {
  if (!children.length) return {processes:0,rssMiB:0,privateMiB:0,cpuMs:0};
  const ids=children.map(p=>p.pid).join(",");
  const rows=[JSON.parse(execFileSync(ps,["-NoProfile","-Command","Get-Process -Id "+ids+
    " | Select-Object WorkingSet64,PrivateMemorySize64,CPU | ConvertTo-Json -Compress"],{encoding:"utf8",windowsHide:true}))].flat();
  const sum=key=>rows.reduce((a,r)=>a+r[key],0);
  return {processes:rows.length,rssMiB:sum("WorkingSet64")/1048576,privateMiB:sum("PrivateMemorySize64")/1048576,cpuMs:sum("CPU")*1000};
}
async function inhibitor(native) {
  // Same PowerShell command and parent PID lifetime as KeepAwake.inhibitorCommand.
  const script = fs.readFileSync(new URL("../../../apps/server/src/background/KeepAwake.ts",import.meta.url),"utf8")
    .match(/const WINDOWS_HOLD_SCRIPT = `([^`]+)`/)[1];
  const t = performance.now();
  const child = native ? start(target,["--chronos-keep-awake"]) :
    start(ps,["-NoProfile","-NonInteractive","-Command",script+"; Wait-Process -Id "+process.pid]);
  const exited=once(child,"exit");
  const lines=createInterface({input:child.stdout});
  const [line]=await once(lines,"line",{signal:AbortSignal.timeout(10000)});
  const readyMs=performance.now()-t;
  if(native) assert.equal(line,"held");
  const sample=footprint([child]);
  const consoleCount=Number(execFileSync(ps,["-NoProfile","-Command",
    `@(Get-CimInstance Win32_Process -Filter "Name='conhost.exe' AND ParentProcessId=${child.pid}").Count`],
    {encoding:"utf8",windowsHide:true}).trim());
  if(native) assert.equal(consoleCount,0);

  if(native) child.stdin.end(); else child.kill();
  const [code]=await exited;
  if(native) assert.equal(code,0);
  console.log(JSON.stringify({native,readyMs,consoleCount,...sample}));
}
async function parentExit() {
  const script = `const child=require("node:child_process").spawn(process.argv[1],["--chronos-keep-awake"],
    {windowsHide:true,stdio:["pipe","pipe","pipe"]});
    child.stdout.once("data",()=>process.send(child.pid,()=>process.exit(0)));`;
  const parent=start(process.execPath,["-e",script,target],true);
  const exited=once(parent,"exit");
  const [pid]=await once(parent,"message",{signal:AbortSignal.timeout(10000)});
  assert.equal((await exited)[0],0);
  const live=()=>{try{process.kill(pid,0);return true}catch(e){if(e.code==="ESRCH")return false;throw e}};
  for(let i=0;i<100&&live();i++) await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(live(),false,"native hold survived its owner");
}
async function snapshot(lazy) {
  const exe=path.resolve(target,"Chronos.exe"), dir=path.resolve(target,"resources/app.asar/apps/desktop/dist-electron/snapShot");
  const readies=[];
  function slot(name,args) {
    return makeStandbyProcess(()=>{
      const t=performance.now();
      const child=start(exe,[path.join(dir,name+"Worker.cjs"),...args],true);
      const ready=once(child,"message",{signal:AbortSignal.timeout(10000)}).then(([msg])=>{
        assert.equal(msg,"ready"); return performance.now()-t;
      });
      readies.push(ready);
      return {child,ready,get alive(){return child.exitCode===null},close:()=>child.kill()};
    },60_000);
  }
  const slots=[slot("RegionSnapShot",[]),slot("SnapShotAccessibility",["read"])];
  if(!lazy) slots.forEach(s=>s.warm());
  // Wait for the same handshake that permits capture. No screenshot or accessibility read is issued.
  await Promise.all(readies);
  const baseline=footprint([...owned]);
  const t=performance.now();
  const workers=slots.map(s=>s.take());
  const readyMs=await Promise.all(workers.map(w=>w.ready));
  const requestToReadyMs=performance.now()-t;
  const exits=workers.map(w=>once(w.child,"exit"));
  workers.forEach(w=>w.close());
  await Promise.all(exits);
  console.log(JSON.stringify({lazy,...baseline,readyMs,requestToReadyMs}));
}
try {
  if(mode==="inhibitor") await parentExit();
  for(const b of [false,true,true,false,false,true]) {
    if(mode==="inhibitor") await inhibitor(b);
    else if(mode==="snapshot") await snapshot(b);
    else throw Error("Use inhibitor <built native helper> or snapshot <unpacked Chronos>");
  }
} finally {
  const exits=[...owned].map(p=>{const exit=once(p,"exit");p.kill();return exit});
  await Promise.allSettled(exits);
  fs.rmSync(tmp,{recursive:true,force:true,maxRetries:4,retryDelay:100});
}

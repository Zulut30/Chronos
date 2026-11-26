import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeTimersPromises from "node:timers/promises";
import { waitFor } from "./artifact-wait.mjs";

export async function verifyWarmLaunch(readFrame, id, desktopPid, opts) {
  const footprint=()=>JSON.parse(NodeChildProcess.execFileSync("powershell.exe",["-NoProfile","-File",
    NodePath.join(import.meta.dirname,"../artifact-process-tree.ps1"),String(desktopPid)],{encoding:"utf8",windowsHide:true}));
  // Tab transitions may leave short-lived Chromium helpers. Sample after the tree settles.
  let baseline=footprint();
  for(let round=0; round<5; round++) {
    await NodeTimersPromises.setTimeout(1000);
    const sample=footprint();
    const stable=sample.processes===baseline.processes && Math.abs(sample.privateBytes-baseline.privateBytes)<4*1024**2;
    baseline=sample;
    if(stable) break;
  }
  const start=Date.now();
  const child=NodeChildProcess.spawn(opts.launch,["--chronos-artifact="+id],{stdio:"ignore",windowsHide:true});
  const exited=new Promise((resolve,reject)=>{child.once("error",reject);child.once("exit",resolve);});
  const packageFrame=await waitFor("warm installed window first paint",()=>{
    const frame=readFrame();return frame?.firstPaintAt>=start ? frame : null;
  });
  NodeAssert.equal(await exited,0);
  await NodeTimersPromises.setTimeout(1500);
  const observed=footprint();
  console.log("PACKAGED_WARM",JSON.stringify({firstPaintMs:Math.round(packageFrame.firstPaintAt-start),
    privateBytes:observed.privateBytes-baseline.privateBytes,workingSet:observed.workingSet-baseline.workingSet,
    before:baseline,after:observed}));
}

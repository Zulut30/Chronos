import assert from "node:assert/strict";
import {execFileSync,spawn} from "node:child_process";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {setTimeout as delay} from "node:timers/promises";
import {writeFileSync} from "node:fs";

async function waitFor(label,test) {
  const end=Date.now()+45000;
  let last;
  do {
    try {const result=await test();if (result) return result;} catch(e) {last=e;}
    await delay(200);
  } while(Date.now()<end);
  throw Error(label+" timed out"+(last ? ": "+last.message : ""));
}
export async function verifyArtifacts(client, opts, desktopPid) {
  if (!process.env.RUNNER_TEMP || !process.env.CHRONOS_HOME || !opts.launch) throw Error("Artifact smoke requires the isolated Windows CI install");
  const services=path.join(path.dirname(opts.launch),"resources","chronos-services");
  const {openArtifacts}=await import(pathToFileURL(path.join(services,"artifacts","store.mjs")));
  const {showArtifact}=await import(pathToFileURL(path.join(services,"artifacts","gallery.mjs")));
  const store=openArtifacts(process.env.CHRONOS_HOME);
  async function evaluate(expression) {
    const r=await client.send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});
    if(r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  try {
    const input={source:path.join(process.env.RUNNER_TEMP,"artifact-smoke.html"),title:"Проверка артефакта",label:"Проверка",icon:"🗂",description:"Тест приложения",capabilities:["theme","db"],
      files:{"index.html":`<!doctype html><html lang="ru"><meta charset="utf-8"><title>Проверка артефакта</title><body>Готово<script>
      new PerformanceObserver(async list => {
        const frame=list.getEntries().find(e=>e.name==="first-contentful-paint");
        if(!frame) return;
        const value={firstPaintAt:performance.timeOrigin+frame.startTime,node:typeof require,mode:chronos.theme.get().mode,files:typeof chronos.files,host:location.hostname,alias:typeof claude.db.get};
        const row={collection:"probe",key:"frame"};
        const prior=await chronos.db.get(row);
        await chronos.db.set({...row,value:{...value,opens:(prior?.opens || 0)+1}});
      }).observe({type:"paint",buffered:true});
      </script></html>`}};
    const {id}=store.publish(input);
    await client.probe("performAction",{type:"navigate",to:"/"});
    await waitFor("gallery link",()=>evaluate(`Boolean(document.querySelector('button[aria-label="Артефакты"]'))`));
    await evaluate(`document.querySelector('button[aria-label="Артефакты"]').click()`);
    await waitFor("Studio gallery",()=>evaluate(`Boolean(document.querySelector('dialog iframe[src*="/artifacts.html"],webview[src*="/artifacts.html"]'))`));
    await showArtifact(id);
    const row=await waitFor("isolated page wrote to MCP database",()=>store.documents(id,"get",{collection:"probe",key:"frame"}));
    assert.equal(row.host,id);
    assert.equal(row.node,"undefined");
    assert.equal(row.files,"undefined");
    assert.equal(row.alias,"function");
    assert.ok(["light","dark"].includes(row.mode));
    await evaluate(`[...document.querySelectorAll("button")].find(b=>b.textContent==="Установить как приложение").click()`);
    await waitFor("Windows shortcuts",()=>evaluate(`document.body.innerText.includes("Ярлыки добавлены")`));
    // Use the app's own authenticated session to create an empty local thread; no model turn is run.
    await evaluate(`(async()=>{
      window.__olyStudioShell.close();
      const socket=window.__olyStudio.ws;
      async function call(tag,payload) {
        const id=String(800000000+Math.floor(Math.random()*9000000));
        return new Promise((resolve,reject)=>{
          let buffer="";
          const cleanup=()=>{clearTimeout(timer);socket.removeEventListener("message",receive);};
          const timer=setTimeout(()=>{cleanup();reject(Error(tag+" timed out"));},15000);
          function receive(event) {
            if(typeof event.data!=="string")return;
            if(event.data.charCodeAt(0)===30){buffer+=event.data.slice(1);return;}
            const raw=buffer+event.data;buffer="";
            if(!raw.includes(id))return;
            for(const msg of [JSON.parse(raw)].flat()){
              if(msg._tag!=="Exit" || String(msg.requestId)!==id)continue;
              cleanup();
              if(msg.exit._tag==="Success")resolve(msg.exit.value);else reject(Error(tag+" failed"));
            }
          }
          socket.addEventListener("message",receive);
          socket.send(JSON.stringify({_tag:"Request",id,tag,payload,headers:[]}));
        });
      }
      const {environment}=await call("server.getConfig",{});
      const {projectId}=await call("projects.ensureScratch",{});
      const threadId=crypto.randomUUID();
      await call("orchestration.dispatchCommand",{type:"thread.create",createdBy:"user",creationSource:"web",
        commandId:crypto.randomUUID(),projectId,threadId,title:"Проверка панели",runtimeMode:"approval-required",interactionMode:"default",
        modelSelection:{instanceId:"codex",model:"smoke"},branch:null,worktreePath:null});
      await window.__TSR_ROUTER__.navigate({to:"/"+environment.environmentId+"/"+threadId});
      return true;
    })()`);
    await showArtifact(id);
    await waitFor("artifact guest visible inside thread right panel",()=>evaluate(`(() => {
      const guest=document.querySelector('[data-electron-browser-host] webview[src="chronos-artifact://${id}/index.html"]');
      const r=guest?.getBoundingClientRect();
      return !!r && r.width>100 && r.height>100 && r.right>0 && r.left<innerWidth && !document.querySelector('dialog[open] webview');
    })()`));
    const footprint=()=>JSON.parse(execFileSync("powershell.exe",["-NoProfile","-File",
      path.join(import.meta.dirname,"artifact-process-tree.ps1"),String(desktopPid)],{encoding:"utf8",windowsHide:true}));
    const readFrame=()=>store.documents(id,"get",{collection:"probe",key:"frame"});
    await waitFor("panel first paint",()=>readFrame()?.opens>=2);
    const baseline=footprint();
    const start=Date.now();
    const child=spawn(opts.launch,["--chronos-artifact="+id],{stdio:"ignore",windowsHide:true});
    const exited=new Promise((resolve,reject)=>{child.once("error",reject);child.once("exit",resolve);});
    const packageFrame=await waitFor("warm installed window first paint",()=>{
      const frame=readFrame();return frame?.firstPaintAt>=start ? frame : null;
    });
    assert.equal(await exited,0);
    await delay(1500);
    const observed=footprint();
    console.log("PACKAGED_WARM",JSON.stringify({firstPaintMs:Math.round(packageFrame.firstPaintAt-start),
      privateBytes:observed.privateBytes-baseline.privateBytes,workingSet:observed.workingSet-baseline.workingSet,
      before:baseline,after:observed}));
    writeFileSync(path.join(opts.outDir,"artifact-id.txt"),id);
    console.log("PASS: gallery, thread right panel, Studio open, isolated page, DB round trip, capability filtering and shortcut installation");
  } catch(error) {
    const state=await evaluate(`({route:location.pathname,dialog:document.querySelector("dialog[open]")?.getAttribute("aria-label"),
      guests:[...document.querySelectorAll("webview,dialog iframe")].map(el=>el.getAttribute("src")?.split("?")[0]),
      bridge:Boolean(window.desktopBridge?.preview),studioSocket:window.__olyStudio?.ws?.readyState,
      status:[...document.querySelectorAll('[role="status"]')].map(el=>el.textContent?.slice(0,180)).filter(Boolean)})`).catch(()=>null);
    console.error("Artifact smoke UI",JSON.stringify(state));
    throw error;
  } finally {store.close();}
}

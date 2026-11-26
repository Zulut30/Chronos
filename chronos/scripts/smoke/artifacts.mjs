import assert from "node:assert/strict";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {writeFileSync} from "node:fs";

import { verifyStudioGallery } from "./features/artifact-gallery.mjs";
import { verifyTabsExample } from "./features/artifact-tabs.mjs";
import { waitFor } from "./features/artifact-wait.mjs";
import { verifyWarmLaunch } from "./features/artifact-warm-launch.mjs";

export async function verifyArtifacts(client, opts, desktopPid) {
  if (!process.env.RUNNER_TEMP || !process.env.CHRONOS_HOME || !opts.launch) throw Error("Artifact smoke requires the isolated CI install");
  const resources = process.platform === "darwin"
    ? path.join(path.dirname(opts.launch), "..", "Resources")
    : path.join(path.dirname(opts.launch), "resources");
  const services = path.join(resources, "chronos-services");
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
      document.body.style.background="rgb(55,101,160)";
      if(window.chronos) new PerformanceObserver(async list => {
        const frame=list.getEntries().find(e=>e.name==="first-contentful-paint");
        if(!frame) return;
        const value={firstPaintAt:performance.timeOrigin+frame.startTime,node:typeof require,mode:chronos.theme.get().mode,files:typeof chronos.files,host:location.hostname,alias:typeof claude.db.get};
        const row={collection:"probe",key:"frame"};
        const prior=await chronos.db.get(row);
        await chronos.db.set({...row,value:{...value,opens:(prior?.opens || 0)+1}});
      }).observe({type:"paint",buffered:true});
      </script></html>`}};
    const {id}=store.publish(input);
    const {artifactTools} = await import(pathToFileURL(path.join(services,"artifacts","tools.mjs")));
    const example = await artifactTools.find(tool => tool.name === "artifact_example").run({});
    const sample={...example,source:path.join(process.env.RUNNER_TEMP,"gallery-sample.html"),title:"Полировка "+"Д".repeat(180)};
    const temporary=store.publish(sample);
    store.publish({...sample,expectedVersion:1,label:"Вторая версия"});
    await client.probe("performAction",{type:"navigate",to:"/"});
    await waitFor("gallery link",()=>evaluate(`Boolean(document.querySelector('button[aria-label="Артефакты"]'))`));
    // Exercise the HTML gallery used by the browser fallback as well as the native desktop gallery.
    await evaluate(`(() => {
      const frame=document.createElement("iframe");
      frame.id="artifact-fallback-smoke";frame.src="http://127.0.0.1:4520/artifacts.html#theme=light";
      frame.style.cssText="position:fixed;inset:0;width:100%;height:100%;z-index:99999";
      document.body.append(frame);
    })()`);
    try {await verifyStudioGallery(client,temporary.id);}
    finally {await evaluate("document.querySelector('#artifact-fallback-smoke')?.remove()");}
    assert.equal(store.history(temporary.id).length,3);
    await evaluate(`document.querySelector('button[aria-label="Артефакты"]').click()`);
    await waitFor("Studio gallery",()=>evaluate(`Boolean(document.querySelector('[data-artifact-gallery] .art-card'))`));
    await waitFor("static gallery snapshot",()=>evaluate(`Boolean(document.querySelector('.art-cover img[src^="data:image/jpeg"]')) && !document.querySelector('[data-artifact-gallery] iframe,[data-artifact-gallery] webview')`));
    await waitFor("thumbnail contains the JavaScript-rendered background",()=>evaluate(`(() => {
      const img=document.querySelector('article[data-id="${id}"] .art-cover img');
      if(!img?.naturalWidth)return false;
      const canvas=document.createElement('canvas');
      const ctx=canvas.getContext('2d');
      ctx.drawImage(img,0,0,16,16);
      const [r,g,b]=ctx.getImageData(8,8,1,1).data;
      return Math.abs(r-55)<8 && Math.abs(g-101)<8 && Math.abs(b-160)<8;
    })()`));
    assert.equal(store.documents(id,"get",{collection:"probe",key:"frame"}),null);
    await verifyTabsExample(client,evaluate,temporary.id);
    const sampleCard=`document.querySelector('article[data-id="${temporary.id}"]')`;
    const removeCard=sampleCard+`.querySelector('[aria-label="В корзину"]')`;
    await evaluate(removeCard+".focus();document.activeElement.click()");
    await waitFor("native confirmation defaults to cancel",()=>evaluate('document.activeElement.value==="cancel"'));
    await evaluate("document.activeElement.click()");
    await waitFor("native cancel restores invoking button",()=>evaluate(removeCard+"===document.activeElement"));
    await evaluate(removeCard+".click()");
    await waitFor("native trash confirmation",()=>evaluate('!!document.querySelector(".art-confirm[open]")'));
    await evaluate(`document.querySelector('.art-confirm [value="delete"]').click()`);
    await waitFor("native trash preserves search focus",()=>evaluate(sampleCard+"===null && document.activeElement.matches('.art-filter input')"));
    assert.equal(store.list(true).some(card=>card.id===temporary.id),true);
    assert.equal(store.history(temporary.id).length,3);
    await evaluate(`document.querySelector('article[data-id="${id}"] .art-cover').click()`);
    const row=await waitFor("isolated page wrote to MCP database",()=>store.documents(id,"get",{collection:"probe",key:"frame"}));
    assert.equal(row.host,id);
    assert.equal(row.node,"undefined");
    assert.equal(row.files,"undefined");
    assert.equal(row.alias,"function");
    assert.ok(["light","dark"].includes(row.mode));
    await evaluate(`[...document.querySelectorAll(".art-segment button")].find(b=>b.textContent==="Код").click()`);
    await waitFor("version source",()=>evaluate(`document.querySelector(".art-code pre")?.textContent.includes("PerformanceObserver")`));
    if (process.platform === "win32") {
      async function shortcutAction(label) {
        await waitFor("actions menu closed",()=>evaluate('!document.querySelector(".art-menu")'));
        await evaluate(`document.querySelector('[aria-label="Действия"]').click()`);
        const button=`[...document.querySelectorAll(".art-menu button")].find(b=>!b.disabled && b.textContent===${JSON.stringify(label)})`;
        await waitFor(label,()=>evaluate("Boolean("+button+")"));
        await evaluate(button+".click()");
      }
      await shortcutAction("Установить как приложение");
      await shortcutAction("Обновить ярлыки");
      await shortcutAction("Удалить ярлыки");
      await waitFor("both shortcuts removed",()=>evaluate(`window.chronosArtifactInstaller.installed("${id}").then(value=>!value)`));
      assert.equal(store.history(id).length,1);
      await shortcutAction("Установить как приложение");
      await waitFor("Windows shortcuts",()=>evaluate(`document.body.innerText.includes("Ярлыки добавлены")`));
    } else {
      await waitFor("actions menu closed",()=>evaluate('!document.querySelector(".art-menu")'));
      await evaluate(`document.querySelector('[aria-label="Действия"]').click()`);
      await waitFor("actions menu",()=>evaluate('Boolean(document.querySelector(".art-menu"))'));
      const hasInstallButton = await evaluate(`Boolean([...document.querySelectorAll(".art-menu button")].find(b=>b.textContent==="Установить как приложение"))`);
      assert.equal(hasInstallButton, false, "Windows-only shortcut installer should be hidden on macOS/Linux");
      await evaluate(`document.querySelector('[aria-label="Действия"]').click()`);
    }
    // Use the app's own authenticated session to create an empty local thread; no model turn is run.
    await evaluate(`(async()=>{
      document.querySelector('dialog.art-dialog [aria-label="Закрыть"]').click();
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
      const guest=document.querySelector('[data-artifact-tab] webview[src="chronos-artifact://${id}/index.html"]');
      const r=guest?.getBoundingClientRect();
      return !!r && r.width>100 && r.height>100 && r.right>0 && r.left<innerWidth && !document.querySelector('dialog[open] webview');
    })()`));
    await evaluate(`document.querySelector('[data-artifact-tab] .art-segment button:nth-child(2)').click()`);
    await waitFor("source stays in native artifact tab",()=>evaluate(`document.querySelector('[data-artifact-tab] pre')?.textContent.includes("PerformanceObserver")`));
    await evaluate(`document.querySelector('[data-artifact-tab] [aria-label="К артефактам"]').click()`);
    await waitFor("gallery stays in native tab",()=>evaluate(`Boolean(document.querySelector('[data-artifact-tab] .art-cover'))`));
    await evaluate(`document.querySelector('[data-artifact-tab] .art-cover').click()`);
    const readFrame=()=>store.documents(id,"get",{collection:"probe",key:"frame"});
    await waitFor("panel first paint",()=>readFrame()?.opens>=2);
    if (process.platform === "win32") {
      await verifyWarmLaunch(readFrame, id, desktopPid, opts);
      writeFileSync(path.join(opts.outDir,"artifact-id.txt"),id);
      console.log("PASS: gallery, thread right panel, Studio open, isolated page, DB round trip, capability filtering and shortcut installation");
    } else {
      console.log("PASS: gallery, thread right panel, Studio open, isolated page, DB round trip and capability filtering");
    }
  } catch(error) {
    const state=await evaluate(`({route:location.pathname,dialog:document.querySelector("dialog[open]")?.getAttribute("aria-label"),
      guests:[...document.querySelectorAll("webview,dialog iframe")].map(el=>el.getAttribute("src")?.split("?")[0]),
      bridge:Boolean(window.desktopBridge?.preview),studioSocket:window.__olyStudio?.ws?.readyState,
      status:[...document.querySelectorAll('[role="status"]')].map(el=>el.textContent?.slice(0,180)).filter(Boolean)})`).catch(()=>null);
    console.error("Artifact smoke UI",JSON.stringify(state));
    throw error;
  } finally {store.close();}
}

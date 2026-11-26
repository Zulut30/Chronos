import { smokeRpc } from "./local-rpc.mjs";
import assert from "node:assert/strict";
import {execFileSync,spawn} from "node:child_process";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {setTimeout as delay} from "node:timers/promises";
import {writeFileSync} from "node:fs";

export async function withSmokeFrame(client, prefix, read) {
  const match = url => url.startsWith(prefix);
  const target = await waitFor("packaged frame " + prefix, async () => {
    const { frameTree } = await client.send("Page.getFrameTree");
    const frame = frameTree.childFrames?.find(node => match(node.frame.url));
    if (frame) {
      const { executionContextId } = await client.send("Page.createIsolatedWorld",{frameId:frame.frame.id,worldName:"chronos-smoke"});
      return { contextId:executionContextId };
    }
    const { targetInfos } = await client.send("Target.getTargets");
    const guest = targetInfos.find(info => match(info.url));
    if (guest) return client.send("Target.attachToTarget",{targetId:guest.targetId,flatten:true});
  });
  const evaluate = async expression => {
    const reply = await client.send("Runtime.evaluate",{expression,contextId:target.contextId,returnByValue:true,awaitPromise:true},30000,target.sessionId);
    if (reply.exceptionDetails) throw Error(reply.exceptionDetails.exception?.description || reply.exceptionDetails.text);
    return reply.result.value;
  };
  try {
    return await read(evaluate);
  } finally {
    if (target.sessionId) await client.send("Target.detachFromTarget",{sessionId:target.sessionId});
  }
}

async function verifyStudioGallery(client, id) {
  await withSmokeFrame(client, "http://127.0.0.1:4520/artifacts.html", async evaluate => {
    const card = `document.querySelector('article[data-id="${id}"]')`;
    await waitFor("gallery card",()=>evaluate(card + " !== null"));
    assert.equal(await evaluate("document.documentElement.style.colorScheme"),"light");
    const search = value => evaluate(`document.querySelector("#search").value=${JSON.stringify(value)};document.querySelector("#search").dispatchEvent(new Event("input"));true`);
    await search("несуществующий артефакт");
    assert.equal(await evaluate('document.querySelector("#status").textContent'),"Ничего не найдено");
    await search("полировка");
    await evaluate(card+'.querySelector("[data-pin]").click()');
    await waitFor("pin and focus",()=>evaluate(card+'.querySelector("[data-pin]") === document.activeElement && document.activeElement.textContent === "Открепить"'));
    await evaluate(card+'.querySelector("summary").click()');
    await waitFor("two versions",()=>evaluate(card+'.querySelectorAll("li").length === 2'));
    await evaluate(card+'.querySelector("li button").click()');
    await waitFor("restored version",()=>evaluate(card+'.querySelectorAll("li").length === 3'));
    await evaluate(card+'.querySelector("nav button:last-child").focus();document.activeElement.click()');
    assert.equal(await evaluate('document.activeElement.value'),"cancel");
    await evaluate('document.querySelector("button[value=cancel]").click()');
    assert.equal(await evaluate(card+'.querySelector("nav button:last-child") === document.activeElement'),true);
    await evaluate(card+'.querySelector("nav button:last-child").click()');
    await evaluate('document.querySelector("button[value=delete]").click()');
    await waitFor("deletion",()=>evaluate(card+' === null && document.activeElement.id === "search"'));
    await evaluate('document.querySelector("#status button").click()');
    await waitFor("undo preserves the restored history",()=>evaluate(card+' !== null && '+card+'.querySelector("[data-pin]") === document.activeElement'));
    await search("");
  });
}

async function waitFor(label,test) {
  const end=Date.now()+45000;
  let last;
  do {
    try {const result=await test();if (result) return result;} catch(e) {last=e;}
    await delay(200);
  } while(Date.now()<end);
  throw Error(label+" timed out"+(last ? ": "+last.message : ""));
}

async function verifyTabsExample(client, evaluate, id) {
  const card = `article[data-id="${id}"] .art-cover`;
  await evaluate(`document.querySelector('${card}').click()`);
  const guestUrl = `chronos-artifact://${id}/index.html`;
  const guest = await waitFor("tabs example guest", async () => {
    const {targetInfos} = await client.send("Target.getTargets");
    return targetInfos.find(target => target.type === "webview" && target.url === guestUrl);
  });
  const {sessionId} = await client.send("Target.attachToTarget", {targetId:guest.targetId, flatten:true});
  const page = async expression => {
    const reply = await client.send("Runtime.evaluate", {expression,returnByValue:true},30000,sessionId);
    if (reply.exceptionDetails) throw Error(reply.exceptionDetails.exception?.description || reply.exceptionDetails.text);
    return reply.result.value;
  };
  const wasDark = await evaluate('document.documentElement.classList.contains("dark")');
  try {
    await waitFor("pinned UI SDK registered its tabs", () => page('document.querySelectorAll("button[role=tab]").length === 2'));
    assert.equal(await page('document.querySelector("[role=tablist]").getAttribute("aria-label")'), "Разделы плана");
    await evaluate('document.querySelector("[data-artifact-view] webview").focus()');
    await page('document.querySelector("button[aria-selected=true]").focus()');
    for (const [key, keyCode, value, name] of [["ArrowRight",39,"meetings","Встречи"],["ArrowLeft",37,"tasks","Задачи"]]) {
      for (const type of ["rawKeyDown","keyUp"]) {
        await client.send("Input.dispatchKeyEvent", {type,key,code:key,windowsVirtualKeyCode:keyCode},30000,sessionId);
      }
      await waitFor("keyboard selected "+value, () => page(`(() => {
        const tab=document.activeElement, visible=[...document.querySelectorAll("[role=tabpanel]")].filter(el=>el.getClientRects().length);
        return tab.textContent===${JSON.stringify(name)} && tab.matches("button[data-selected][aria-selected=true]") &&
          visible.length===1 && visible[0].getAttribute("value")===${JSON.stringify(value)};
      })()`));
    }
    const backgrounds = [];
    for (const mode of ["light","dark"]) {
      await evaluate(`document.documentElement.classList.toggle("dark",${mode === "dark"})`);
      await waitFor("guest theme "+mode, () => page(`document.documentElement.dataset.theme==="${mode}"`));
      const colors = await page(`(() => {
        const selected=getComputedStyle(document.activeElement), other=getComputedStyle(document.querySelector("button:not([data-selected])"));
        const body=getComputedStyle(document.body);
        return {paper:body.backgroundColor,ink:body.color,fill:selected.backgroundColor,onFill:selected.color,
          edge:other.borderTopColor,ring:selected.outlineColor,ringWidth:parseFloat(selected.outlineWidth)};
      })()`);
      const luminance = color => {
        const channels = color.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>n/255)
          .map(n=>n<=0.04045 ? n/12.92 : ((n+0.055)/1.055)**2.4);
        return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;
      };
      for (const [a,b,min] of [["ink","paper",4.5],["onFill","fill",4.5],["edge","paper",3],["ring","paper",3],["fill","paper",3]]) {
        const l=luminance(colors[a]), r=luminance(colors[b]);
        assert.ok((Math.max(l,r)+0.05)/(Math.min(l,r)+0.05)>=min, mode+" contrast "+a+"/"+b);
      }
      assert.ok(colors.ringWidth >= 2, "Visible keyboard focus in "+mode);
      backgrounds.push(colors.paper);
    }
    assert.notEqual(backgrounds[0],backgrounds[1]);
    console.log("PASS: packaged UI SDK tabs, arrow keys, focus, selection and contrast in both themes");
  } finally {
    await evaluate(`document.documentElement.classList.toggle("dark",${wasDark})`);
    await client.send("Target.detachFromTarget",{sessionId});
  }
  await evaluate(`document.querySelector('[aria-label="К артефактам"]').click()`);
  await waitFor("back to gallery after tabs", () => evaluate(`Boolean(document.querySelector('${card}'))`));
}

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
      const call = (${smokeRpc});
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
      const footprint=()=>JSON.parse(execFileSync("powershell.exe",["-NoProfile","-File",
        path.join(import.meta.dirname,"artifact-process-tree.ps1"),String(desktopPid)],{encoding:"utf8",windowsHide:true}));
      // Tab transitions may leave short-lived Chromium helpers. Sample after the tree settles.
      let baseline=footprint();
      for(let round=0; round<5; round++) {
        await delay(1000);
        const sample=footprint();
        const stable=sample.processes===baseline.processes && Math.abs(sample.privateBytes-baseline.privateBytes)<4*1024**2;
        baseline=sample;
        if(stable) break;
      }
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

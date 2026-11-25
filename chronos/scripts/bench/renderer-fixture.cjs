// Entry for an isolated copy of the CI Electron runtime (resources/app/main.cjs).
// No network navigation, CDP, login or production profile.
const { app, BrowserWindow, webContents } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { setTimeout:delay } = require("node:timers/promises");

const root = process.env.CHRONOS_RENDER_BENCH;
if (!root || !path.isAbsolute(root)) throw Error("Missing fixture directory");
app.setPath("userData", path.join(root,"profile"));
const mode=process.env.CHRONOS_RENDER_FLAGS;
if(mode==="size") app.commandLine.appendSwitch("js-flags","--optimize-for-size");
if(mode==="spare") app.commandLine.appendSwitch("disable-features","SpareRendererForSitePerProcess");
let stage="startup";
const watchdog=setTimeout(()=>{fs.writeFileSync(path.join(root,"error.txt"),"Renderer timeout during "+stage);app.exit(2)},20000);
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,width:900,height:640,skipTaskbar:true,
    webPreferences:{offscreen:true,backgroundThrottling:false,webviewTag:true,sandbox:true}});
  win.webContents.on("paint",()=>{});
  win.webContents.setFrameRate(60);
  const fixture=path.join(root,"page.html");
  fs.writeFileSync(fixture,'<!doctype html><meta charset="utf-8"><input id="draft"><main></main>');
  stage="host load";
  await win.loadFile(fixture);
  const wc=win.webContents, js=code=>wc.executeJavaScript(code);
  const metrics=()=> {
    const processes=app.getAppMetrics();
    return {processes:processes.length,guests:webContents.getAllWebContents().filter(w=>w.getType()==="webview").length,
      privateMiB:processes.reduce((n,p)=>n+(p.memory.privateBytes||0),0)/1024,
      rssMiB:processes.reduce((n,p)=>n+p.memory.workingSetSize,0)/1024};
  };
  const url=JSON.stringify(pathToFileURL(fixture).href);
  stage="guest attachment";
  await js(`Promise.all([0,1].map(i=>new Promise(resolve=>{
    const guest=document.createElement("webview");guest.id="g"+i;guest.src=${url};
    guest.addEventListener("dom-ready",resolve,{once:true});document.body.append(guest);
  }))).then(()=>true)`);
  await js('document.querySelector("#g1").style.visibility="hidden";true');
  const guestId=await js('document.querySelector("#g1").getWebContentsId()');
  await webContents.fromId(guestId).executeJavaScript('draft.value="unsaved";true');
  stage="animation frames";
  const frames=await js(`new Promise(resolve=>{
    let last, index=0;const samples=[];
    function frame(now){
      if(last!==undefined) samples.push(now-last);last=now;
      const nodes=Array.from({length:180},(_,i)=>{
        const el=document.createElement("div");el.textContent="Message "+i+" "+index;return el});
      document.querySelector("main").replaceChildren(...nodes);
      if(++index<100) requestAnimationFrame(frame);else resolve(samples.sort((a,b)=>a-b)[93]);
    }requestAnimationFrame(frame);
  })`);
  await delay(250);
  const before=metrics();
  await js('document.querySelector("#g1").remove();true');
  for(let i=0;i<50 && webContents.fromId(guestId);i++) await delay(20);
  await delay(500);
  const after=metrics();
  if(before.guests!==2 || after.guests!==1 || webContents.fromId(guestId)) throw Error("Unexpected guest lifecycle");
  fs.writeFileSync(path.join(root,"result.json"),JSON.stringify({mode,frameP95Ms:frames,before,after}));
  win.destroy(); clearTimeout(watchdog); app.exit(0);
}).catch(error=>{fs.writeFileSync(path.join(root,"error.txt"),String(error.stack));app.exit(1)});

const {app,BrowserWindow,protocol,dialog} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const {uuid} = require("./policy.mjs");
const runtime = require("./runtime.cjs");
const windows = new Map();
function requestId(argv) {
  const flag=argv.find(arg=>arg.startsWith("--chronos-artifact="));
  const id=flag?.slice("--chronos-artifact=".length);
  return id && uuid.test(id) ? id : null;
}
async function open(id) {
  await app.whenReady();
  try {
    const existing=windows.get(id);
    if(existing && !existing.isDestroyed()) {existing.restore();existing.show();existing.focus();return;}
    const metadata=runtime.db().metadata(id);
    const iconBase=path.join(app.getPath("appData"),"Chronos","artifact-icons",id);
    const icon=iconBase+(process.platform==="win32"?".ico":".png");
    const window=new BrowserWindow({title:metadata.title,width:900,height:680,autoHideMenuBar:true,show:false,
      ...(fs.existsSync(icon)?{icon}:{}),webPreferences:runtime.preferences(id)});
    windows.set(id,window);
    window.removeMenu();
    runtime.protect(window.webContents);
    window.webContents.on("did-finish-load",()=>{
      if (!metadata.capabilities.includes("theme")) return;
      try {window.webContents.send("chronos:artifact-theme",JSON.parse(fs.readFileSync(iconBase+".json","utf8")));} catch {}
    });
    window.once("closed",()=>windows.delete(id));
    window.once("ready-to-show",()=>window.show());
    await window.loadURL("chronos-artifact://"+id+"/index.html");
  } catch (e) {
    windows.get(id)?.destroy();
    dialog.showErrorBox("Не удалось открыть артефакт",e.message);
    if (!BrowserWindow.getAllWindows().length) app.quit();
  }
}
function start(argv) {
  const id=requestId(argv);
  if (!id) {app.exit(2);return;}
  const mainProfile=path.join(app.getPath("appData"),"Chronos");
  // Reuse the desktop process when it owns the normal profile.
  fs.mkdirSync(mainProfile,{recursive:true});
  app.setPath("userData",mainProfile);
  if (!app.requestSingleInstanceLock()) {app.quit();return;}
  app.releaseSingleInstanceLock();
  const profile=path.join(mainProfile,"artifact-apps");
  fs.mkdirSync(profile,{recursive:true});
  app.setPath("userData",profile);
  app.setPath("sessionData",profile);
  if (!app.requestSingleInstanceLock()) {app.quit();return;}
  protocol.registerSchemesAsPrivileged([{scheme:"chronos-artifact",privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
  app.on("second-instance",(_event,args)=>{const next=requestId(args);if(next) void open(next);});
  app.on("window-all-closed",()=>app.quit());
  void open(id);
}
module.exports={start,open,requestId};

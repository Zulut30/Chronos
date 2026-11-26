const {app,BrowserWindow,protocol,dialog} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const {uuid} = require("./policy.mjs");
const runtime = require("./runtime.cjs");
const windows = new Map();
let shortcutHost = false;
const profilePath = () => path.join(app.getPath("appData"),"Chronos");
function requestId(argv) {
  const flag=argv.find(arg=>arg.startsWith("--chronos-artifact="));
  const id=flag?.slice("--chronos-artifact=".length);
  return id && uuid.test(id) ? id : null;
}
async function open(id,version,theme) {
  await app.whenReady();
  let window;
  try {
    if (process.platform === "win32" && !shortcutHost &&
        await require("./standalone-focus.cjs").focusExisting(profilePath(),id,version)) return;
    const existing=windows.get(id);
    const metadata=runtime.db().metadata(id,version);
    if(existing && !existing.isDestroyed()) {
      if (existing.artifactVersion === metadata.version && existing.historicVersion === version) {
        existing.restore();existing.show();existing.focus();return;
      }
      existing.destroy();
    }
    const icon=path.join(app.getPath("appData"),"Chronos","artifact-icons",id+".ico");
    window=new BrowserWindow({title:metadata.title,width:900,height:680,autoHideMenuBar:true,show:false,
      ...(fs.existsSync(icon)?{icon}:{}),webPreferences:runtime.preferences(id,version)});
    window.artifactVersion=metadata.version;
    window.historicVersion=version;
    windows.set(id,window);
    window.removeMenu();
    runtime.protect(window.webContents);
    window.webContents.on("did-finish-load",()=>{
      try {window.webContents.send("chronos:artifact-theme",theme ?? JSON.parse(fs.readFileSync(icon.slice(0,-4)+".json","utf8")));} catch {}
    });
    window.once("closed",()=>{if (windows.get(id)===window) windows.delete(id);});
    window.once("ready-to-show",()=>window.show());
    await window.loadURL("chronos-artifact://"+id+"/index.html");
  } catch (e) {
    if (window?.isDestroyed()) return;
    window?.destroy();
    dialog.showErrorBox("Не удалось открыть артефакт",e.message);
    if (!BrowserWindow.getAllWindows().length) app.quit();
  }
}
function start(argv) {
  const id=requestId(argv);
  if (!id) {app.exit(2);return;}
  const mainProfile=profilePath();
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
  shortcutHost = true;
  if (process.platform === "win32") {
    const server = require("./standalone-focus.cjs").listen(mainProfile,async (id,version) => {
      if (!windows.has(id)) return false;
      await open(id,version);
      return true;
    });
    app.once("will-quit",()=>server.close());
  }
  protocol.registerSchemesAsPrivileged([{scheme:"chronos-artifact",privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
  app.on("second-instance",(_event,args)=>{const next=requestId(args);if(next) void open(next);});
  app.on("window-all-closed",()=>app.quit());
  void open(id);
}
module.exports={start,open,requestId};

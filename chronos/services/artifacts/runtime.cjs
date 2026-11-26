const {session, ipcMain, dialog, app} = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const {openArtifacts} = require("./store.mjs");
const {uuid,own,allowed,resource} = require("./policy.mjs");
const sessions = new WeakMap();
let store;
const db = () => store ??= openArtifacts(process.env.CHRONOS_HOME);
const prefix = "persist:chronos-artifact-";
function identify(event) {
  const {id, version} = sessions.get(event.sender.session) ?? {};
  if (!id || !event.senderFrame || event.senderFrame !== event.sender.mainFrame || !own(new URL(event.senderFrame.url),id))
    throw Error("Запрос вне артефакта");
  return {id,version};
}
function trustedArtifact(event,id) {
  if (!uuid.test(id) || !event.senderFrame || event.senderFrame !== event.sender.mainFrame ||
      new URL(event.senderFrame.url).protocol !== "t3code:" || new URL(event.senderFrame.url).hostname !== "app")
    throw Error("Откройте артефакт в Chronos");
  return db().metadata(id);
}
ipcMain.handle("chronos:artifact-icon",(event,id)=>trustedArtifact(event,id).icon);
ipcMain.handle("chronos:artifact-install",(event,id,image,theme)=>{
  const metadata=trustedArtifact(event,id);
  if (typeof image !== "string" || image.length > 96000 || !image.startsWith("data:image/png;base64,")) throw Error("Некорректный значок");
  return require("./install.cjs").install(id,metadata,image,theme);
});
const fileDialogs = new WeakSet();
ipcMain.handle("chronos:artifact-api",async (event,method,args = {}) => {
  const {id,version} = identify(event);
  if (version && !["db.get","db.list","db.query"].includes(method)) throw Error("Историческая версия открыта для чтения");
  const capability = method.startsWith("db.") ? "db" : method;
  if (!db().metadata(id).capabilities.includes(capability)) throw Error("Возможность отключена");
  if (capability === "db") return db().documents(id, method.slice(3),args);
  if (fileDialogs.has(event.sender)) throw Error("Диалог уже открыт");
  fileDialogs.add(event.sender);
  try {
    if (method === "files.open") {
      const pick = await dialog.showOpenDialog({title:"Открыть файл",properties:["openFile"]});
      if (pick.canceled) return null;
      const file = pick.filePaths[0];
      const fh = await fs.open(file);
      try {
        const st = await fh.stat();
        if (!st.isFile() || st.size > 15 * 1024 ** 2) throw Error("Файл больше 15 МБ");
        const bytes = Buffer.alloc(st.size);
        const {bytesRead} = await fh.read(bytes,0,bytes.length,0);
        return {name:path.basename(file),base64:bytes.subarray(0,bytesRead).toString("base64")};
      } finally {await fh.close();}
    }
    if (method !== "files.save") throw Error("Неизвестная возможность");
    if (typeof args.base64 !== "string" || args.base64.length > 20 * 1024 ** 2) throw Error("Файл больше 15 МБ");
    const name = path.basename(String(args.name || "document")).replace(/[^\p{L}\p{N} ._-]/gu,"_");
    const pick = await dialog.showSaveDialog({title:"Сохранить файл",defaultPath:path.join(app.getPath("documents"),name || "document")});
    if (pick.canceled) return false;
    await fs.writeFile(pick.filePath,Buffer.from(args.base64,"base64"));
    return true;
  } finally {fileDialogs.delete(event.sender);}
});
function preferences(id,version) {
  if (!uuid.test(id)) throw Error("Некорректный адрес");
  const {capabilities} = db().metadata(id,version);
  const partition = version ? "chronos-artifact-history-"+id+"-"+version : prefix+id;
  const ses = session.fromPartition(partition);
  if (!sessions.has(ses)) {
    sessions.set(ses,{id,version});
    ses.protocol.handle("chronos-artifact",req => resource(db(),id,req.url,version));
    ses.webRequest.onBeforeRequest((req,reply) => {
      const url = URL.parse(req.url);
      reply({cancel:!url || !allowed(url,id,req.resourceType === "mainFrame")});
    });
    ses.setPermissionRequestHandler((_wc,_perm,reply) => reply(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on("will-download",event => event.preventDefault());
    ses.setDevicePermissionHandler(() => false);
  }
  return {partition,sandbox:true,nodeIntegration:false,nodeIntegrationInSubFrames:false,
    contextIsolation:true,webSecurity:true,webviewTag:false,plugins:false,
    preload:path.join(__dirname,"preload.cjs"),additionalArguments:["--artifact-caps="+capabilities.join(",")]};
}
function protect(contents) {
  const {id} = sessions.get(contents.session) ?? {};
  if (!id) return false;
  contents.setWindowOpenHandler(()=>({action:"deny"}));
  contents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
  contents.on("will-frame-navigate",event => {
    const url = URL.parse(event.url);
    if (!url || !own(url,id) || !event.isMainFrame) event.preventDefault();
  });
  return true;
}
function attach(event,prefs,params) {
  const historic = /^chronos-artifact-history-([a-f0-9-]{36})-([1-9][0-9]*)$/.exec(params.partition);
  const id = historic ? historic[1] : String(params.partition).slice(prefix.length);
  try {
    if (!uuid.test(id) || !own(new URL(params.src),id)) throw Error("Неверный адрес");
    Object.assign(prefs,preferences(id,historic ? Number(historic[2]) : undefined));
    delete params.allowpopups;
  } catch {event.preventDefault();}
}
module.exports = {attach,protect,preferences,db};

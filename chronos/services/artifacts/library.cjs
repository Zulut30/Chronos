const { bundledTabsRedirect } = require("./bundled-tabs.mjs");
const { BrowserWindow, session, webContents } = require("electron");
const { resource, allowed, uuid } = require("./policy.mjs");
const { encodeSnapshot } = require("./assets.mjs");
const { db } = require("./runtime.cjs");

// Only visible gallery cards request a missing image. Serialize captures, discard the
// renderer immediately and persist the JPEG alongside its version.
let captureQueue = Promise.resolve();
let thumbnailSession;
async function thumbnail(id, version) {
  const cached = db().thumbnail(id,version);
  if (cached) return Buffer.from(cached).toString("base64");
  const capture = captureQueue.then(async () => {
    const existing = db().thumbnail(id,version);
    if (existing) return Buffer.from(existing).toString("base64");
    if (db().metadata(id).version !== version) return null;
    const live = webContents.getAllWebContents().find(contents =>
      contents.getURL() === "chronos-artifact://"+id+"/index.html" &&
      contents.session === session.fromPartition("persist:chronos-artifact-"+id));
    if (live) {
      if (live.isLoading()) return null;
      const image = await live.capturePage();
      if (!image.isEmpty()) {
        const bytes = image.resize({width:400}).toJPEG(78);
        db().saveThumbnail(id,version,bytes);
        return bytes.toString("base64");
      }
    }
    if (!thumbnailSession) {
      thumbnailSession = session.fromPartition("chronos-artifact-thumbnail");
      const ses = thumbnailSession;
      // Set once for this in-memory session. Thumbnail pages have no host preload or file dialogs.
      ses.setPermissionRequestHandler((_wc,_permission,reply) => reply(false));
      ses.setPermissionCheckHandler(() => false);
      ses.setDevicePermissionHandler(() => false);
      ses.on("will-download",event => event.preventDefault());
    }
    const ses = thumbnailSession;
    ses.protocol.handle("chronos-artifact", req => resource(db(),id,req.url,version));
    ses.webRequest.onBeforeRequest((req,reply) => {
      const redirectURL = bundledTabsRedirect(req,id);
      if (redirectURL) return reply({redirectURL});
      const url = URL.parse(req.url);
      const permitted = url && req.method === "GET" &&
        allowed(url,id,req.resourceType === "mainFrame",req.resourceType) &&
        (url.protocol === "chronos-artifact:" || ["script","stylesheet","image","font"].includes(req.resourceType));
      reply({cancel:!permitted});
    });
    let window, deadline;
    try {
      window = new BrowserWindow({show:false,width:720,height:440,useContentSize:true,
        webPreferences:{session:ses,offscreen:true,images:true,sandbox:true,disableDialogs:true,
          nodeIntegration:false,contextIsolation:true,webSecurity:true,backgroundThrottling:false}});
      const contents = window.webContents;
      contents.setAudioMuted(true);
      contents.setWindowOpenHandler(() => ({action:"deny"}));
      contents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
      contents.on("will-frame-navigate",event => event.preventDefault());
      const paint = async () => {
        await window.loadURL("chronos-artifact://"+id+"/index.html");
        // Give framework-rendered content a paint opportunity before taking the static image.
        await contents.executeJavaScript("new Promise(done => {requestAnimationFrame(() => requestAnimationFrame(() => done(true)));setTimeout(() => done(true),300)})");
        return contents.capturePage(undefined,{stayHidden:true});
      };
      const image = await Promise.race([paint(),new Promise((_,reject) => {
        deadline=setTimeout(()=>reject(Error("Время создания миниатюры истекло")),8000);
      })]);
      if (image.isEmpty()) return null;
      const bytes = image.resize({width:400}).toJPEG(78);
      db().saveThumbnail(id,version,bytes);
      return bytes.toString("base64");
    } finally {
      clearTimeout(deadline);
      window?.destroy();
      ses.protocol.unhandle("chronos-artifact");
    }
  });
  captureQueue = capture.catch(() => {});
  return capture;
}

exports.request = async function request(action,args = {}) {
  const store = db();
  if (action === "list") return store.list(args.trash === true).map(({source,...card}) => card);
  const {id,version,expectedVersion} = args;
  if (!uuid.test(id)) throw Error("Некорректная ссылка на артефакт");
  switch (action) {
    case "details": return {...store.metadata(id),origin:store.origin(id),history:store.history(id)};
    case "files": return encodeSnapshot(store.read(id,version)).files;
    case "thumbnail": return thumbnail(id,version);
    case "openWindow": return require("./standalone.cjs").open(id,version,args.theme);
    case "pin": return store.pin(id,args.pinned === true);
    case "trash": return store.remove(id,expectedVersion);
    case "recover": return store.recover(id);
    case "restore": return store.restore(id,version,expectedVersion);
    default: throw Error("Неизвестное действие");
  }
};

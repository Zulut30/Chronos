const { BrowserWindow, session, webContents } = require("electron");
const { resource, own, uuid } = require("./policy.mjs");
const { encodeSnapshot } = require("./assets.mjs");
const { db } = require("./runtime.cjs");

// Only visible gallery cards request a missing image. Serialize captures, discard the
// renderer immediately and persist the JPEG alongside its version. Never run page scripts.
let captureQueue = Promise.resolve();
async function thumbnail(id, version) {
  const cached = db().thumbnail(id,version);
  if (cached) return Buffer.from(cached).toString("base64");
  const capture = captureQueue.then(async () => {
    const existing = db().thumbnail(id,version);
    if (existing) return Buffer.from(existing).toString("base64");
    if (db().metadata(id).version !== version) return null;
    const live = webContents.getAllWebContents().find(contents =>
      contents.getURL() === "chronos-artifact://"+id+"/index.html" &&
      contents.session === session.fromPartition("persist:chronos-artifact-"+id) && !contents.isLoading());
    if (live) {
      const image = await live.capturePage();
      if (!image.isEmpty()) {
        const bytes = image.resize({width:400}).toJPEG(78);
        db().saveThumbnail(id,version,bytes);
        return bytes.toString("base64");
      }
    }
    const ses = session.fromPartition("chronos-artifact-thumbnail");
    ses.protocol.handle("chronos-artifact", req => resource(db(),id,req.url,version));
    ses.webRequest.onBeforeRequest((req,reply) => {
      const url = URL.parse(req.url);
      reply({cancel: !url || !own(url,id)});
    });
    ses.setPermissionRequestHandler((_wc,_permission,reply) => reply(false));
    let window;
    try {
      window = new BrowserWindow({show:false,width:720,height:440,useContentSize:true,
        webPreferences:{session:ses,offscreen:true,javascript:false,images:true,sandbox:true,
          nodeIntegration:false,contextIsolation:true,webSecurity:true}});
      window.webContents.setWindowOpenHandler(() => ({action:"deny"}));
      window.webContents.on("will-navigate", event => event.preventDefault());
      await window.loadURL("chronos-artifact://"+id+"/index.html");
      const image = await window.webContents.capturePage(undefined,{stayHidden:true});
      if (image.isEmpty()) return null;
      const bytes = image.resize({width:400}).toJPEG(78);
      db().saveThumbnail(id,version,bytes);
      return bytes.toString("base64");
    } finally {
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

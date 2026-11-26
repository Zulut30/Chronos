// Offline fixture. The only pages it can load are two empty documents at the app origin.
const { app, BrowserWindow, protocol, session, safeStorage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const root = process.env.CHRONOS_SWITCH_FIXTURE;
if (!root || !path.isAbsolute(root) || !fs.existsSync(path.join(root, "offline-fixture"))) process.exit(2);
app.setPath("userData", path.join(root, "source-profile"));
app.disableHardwareAcceleration();
protocol.registerSchemesAsPrivileged([{ scheme: "t3code", privileges: { standard: true, secure: true } }]);

async function page(ses) {
  ses.webRequest.onBeforeRequest({urls:["http://*/*","https://*/*","ws://*/*","wss://*/*"]},
    (_, done) => done({cancel:true}));
  ses.protocol.handle("t3code", () => new Response("<!doctype html><meta charset=utf-8>", {
    headers: {"content-type":"text/html","content-security-policy":"default-src 'none'"},
  }));
  const win = new BrowserWindow({show:false, webPreferences:{session:ses, sandbox:true, contextIsolation:true}});
  await win.loadURL("t3code://app/");
  return win;
}

app.whenReady().then(async () => {
  const summary = { decryptable: false, protectedEntries: 0, preferences: 0 };
  const envelope = JSON.parse(fs.readFileSync(path.join(root, "connection-catalog.json"), "utf8"));
  const catalog = JSON.parse(safeStorage.decryptString(Buffer.from(envelope.encryptedCatalog, "base64")));
  if (!Array.isArray(catalog.credentials)) throw Error();
  summary.protectedEntries = catalog.credentials.length + (catalog.remoteDpopTokens?.length || 0);
  summary.decryptable = true;
  const source = await page(session.defaultSession);
  const destination = session.fromPath(path.join(root, "clean-storage"));
  const clean = await page(destination);
  // Only known presentation preferences pass. Never import an environment, endpoint, session or auth state.
  const preferences = await source.webContents.executeJavaScript(
    "Object.entries(localStorage).filter(([k]) => /^(oly-plan-v2:|oly-machines-aliases$|oly-speed-v[234]$|oly-studio-client(?:-id)?$)/.test(k))");
  await clean.webContents.executeJavaScript(
    "for (const [key,value] of " + JSON.stringify(preferences) + ") localStorage.setItem(key,value)");
  destination.flushStorageData();
  summary.preferences = preferences.length;
  summary.plan = preferences.filter(([k]) => k.startsWith("oly-plan-v2:")).length;
  summary.aliases = preferences.some(([k]) => k === "oly-machines-aliases");
  summary.studio = preferences.some(([k]) => k.startsWith("oly-studio-client"));
  fs.writeFileSync(path.join(root,"counts.json"), JSON.stringify(summary), {flag:"wx"});
  app.quit();
}).catch(() => app.exit(2));

const {contextBridge,ipcRenderer} = require("electron");
if (process.isMainFrame && location.protocol === "chronos-artifact:") {
  const caps = (process.argv.find(x=>x.startsWith("--artifact-caps=")) || "").slice(16).split(",");
  const api = {};
  if (caps.includes("db")) {
    api.db = Object.fromEntries(["get","list","query","set","update","delete","batch"].map(method =>
      [method, args => ipcRenderer.invoke("chronos:artifact-api","db."+method,args)]));
  }
  const files = {};
  for (const method of ["open","save"]) if(caps.includes("files."+method))
    files[method] = args => ipcRenderer.invoke("chronos:artifact-api","files."+method,args);
  if (Object.keys(files).length) api.files = files;
  {
    const media = matchMedia("(prefers-color-scheme: dark)");
    let current = {mode:media.matches ? "dark" : "light",tokens:{}};
    function apply(value) {
      current = value;
      const root = document.documentElement;
      if (!root) return;
      root.dataset.theme = current.mode;
      root.style.colorScheme = current.mode;
      for (const [key,value] of Object.entries(current.tokens)) if (/^--[a-z-]+$/.test(key) && CSS.supports("color",value)) root.style.setProperty(key,value);
      window.dispatchEvent(new Event("chronosthemechange"));
    }
    if (caps.includes("theme")) api.theme = {get:()=>current};
    ipcRenderer.on("chronos:artifact-theme",(_event,theme)=>apply(theme));
    media.addEventListener("change",() => apply({mode:media.matches ? "dark" : "light",tokens:{}}));
    window.addEventListener("DOMContentLoaded",()=>apply(current),{once:true});
  }
  contextBridge.exposeInMainWorld("chronos",api);
  contextBridge.exposeInMainWorld("claude",api);
}

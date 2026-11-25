const {app,BrowserWindow} = require("electron");
app.setPath("userData",process.env.ARTIFACT_BENCH_PROFILE);
let window;
app.whenReady().then(() => {
  window = new BrowserWindow({width:800,height:600,useContentSize:true,webPreferences:{
    partition:"persist:chronos-artifact-bench",sandbox:true,nodeIntegration:false,contextIsolation:true}});
  return window.loadURL(process.env.ARTIFACT_BENCH_URL);
});

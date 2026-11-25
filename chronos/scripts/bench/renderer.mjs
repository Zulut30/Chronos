import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const distribution=path.resolve(process.argv[2]);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"chronos-renderer-"));
const app=path.join(tmp,"resources/app");
try {
  fs.mkdirSync(app,{recursive:true});
  for(const file of fs.readdirSync(distribution)) {
    if(file!=="Chronos.exe" && !/\.(dll|bin|pak|dat|json)$/.test(file)) continue;
    try { fs.linkSync(path.join(distribution,file),path.join(tmp,file)) }
    catch { fs.copyFileSync(path.join(distribution,file),path.join(tmp,file)) }
  }
  fs.cpSync(path.join(distribution,"locales"),path.join(tmp,"locales"),{recursive:true});
  fs.writeFileSync(path.join(app,"package.json"),JSON.stringify({name:"chronos-perf-fixture",version:"1.0.0",main:"main.cjs"}));
  fs.copyFileSync(new URL("./renderer-fixture.cjs",import.meta.url),path.join(app,"main.cjs"));
  for(const mode of ["base","size","spare","spare","base","size","size","spare","base"]) {
    const root=fs.mkdtempSync(path.join(tmp,"run-"));
    const env={...process.env,HOME:root,USERPROFILE:root,APPDATA:root,LOCALAPPDATA:root,
      TEMP:root,TMP:root,CHRONOS_RENDER_BENCH:root,CHRONOS_RENDER_FLAGS:mode};
    delete env.ELECTRON_RUN_AS_NODE;
    try {execFileSync(path.join(tmp,"Chronos.exe"),["--user-data-dir="+path.join(root,"profile")],
      {env,cwd:root,windowsHide:true,timeout:35000,stdio:"pipe"})}
    catch(error){throw Error(fs.existsSync(path.join(root,"error.txt"))?fs.readFileSync(path.join(root,"error.txt"),"utf8"):String(error)+" status="+error.status+" stderr="+String(error.stderr??""))}
    console.log(fs.readFileSync(path.join(root,"result.json"),"utf8"));
  }
} finally {
  fs.rmSync(tmp,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}

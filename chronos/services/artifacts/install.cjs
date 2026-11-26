const fs = require("node:fs");
const path = require("node:path");
const {app,shell,nativeImage} = require("electron");

function iconFile(bytes) {
  const header=Buffer.alloc(22);
  header.writeUInt16LE(1,2);
  header.writeUInt16LE(1,4);
  header[6]=64; header[7]=64;
  header.writeUInt16LE(1,10); header.writeUInt16LE(32,12);
  header.writeUInt32LE(bytes.length,14);header.writeUInt32LE(22,18);
  return Buffer.concat([header,bytes]);
}
function matches(file,args) {
  try {
    const shortcut=shell.readShortcutLink(file);
    return shortcut.args === args &&
      fs.realpathSync.native(shortcut.target).toLowerCase() === fs.realpathSync.native(process.execPath).toLowerCase();
  } catch {return false;}
}
function directories() {
  return [app.getPath("desktop"),path.join(app.getPath("appData"),"Microsoft","Windows","Start Menu","Programs","Chronos")];
}
function shortcutName(title) {
  const stem=title.replace(/[<>:"/\\|?*\x00-\x1f]/g,"_").slice(0,80).trim().replace(/[. ]+$/,"") || "Артефакт";
  return /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(stem) ? "_"+stem : stem;
}
function ownedLinks(id,titles) {
  const found=new Set();
  for (const dir of directories()) for (const name of new Set(titles.map(shortcutName))) {
    for (const suffix of [".lnk"," ("+id+").lnk"]) {
      const file=path.join(dir,name+suffix);
      if (fs.existsSync(file) && matches(file,"--chronos-artifact="+id)) found.add(file);
    }
  }
  return found;
}
function remove(id,titles) {
  for (const file of ownedLinks(id,titles)) fs.rmSync(file,{force:true});
  const icons=path.join(app.getPath("userData"),"artifact-icons");
  for (const ext of [".ico",".json"]) fs.rmSync(path.join(icons,id+ext),{force:true});
}
function install(id,metadata,iconData,theme,titles) {
  if (process.platform !== "win32") throw Error("Ярлыки доступны в Windows");
  const png=nativeImage.createFromDataURL(iconData);
  if (png.isEmpty() || png.getSize().width !== 64 || png.getSize().height !== 64) throw Error("Некорректный значок");
  const icons=path.join(app.getPath("userData"),"artifact-icons");
  fs.mkdirSync(icons,{recursive:true});
  const icon=path.join(icons,id+".ico");
  fs.writeFileSync(icon,iconFile(png.toPNG()));
  if (["light","dark"].includes(theme?.mode) && theme.tokens && typeof theme.tokens === "object") {
    const tokens=Object.fromEntries(Object.entries(theme.tokens).filter(([k,v]) =>
      /^--[a-z-]{1,48}$/.test(k) && typeof v === "string" && v.length <= 256).slice(0,32));
    fs.writeFileSync(path.join(icons,id+".json"),JSON.stringify({mode:theme.mode,tokens}));
  }
  const args="--chronos-artifact="+id;
  const name=shortcutName(metadata.title);
  const previous=ownedLinks(id,titles);
  const written=new Set();
  const properties={target:process.execPath,args,icon,iconIndex:0,description:metadata.description.slice(0,240),
    appUserModelId:"io.github.zulut30.chronos.artifact."+id};
  for (const dir of directories()) {
    fs.mkdirSync(dir,{recursive:true});
    let file=path.join(dir,name+".lnk");
    if (fs.existsSync(file) && !matches(file,args)) file=path.join(dir,name+" ("+id+").lnk");
    if (fs.existsSync(file) && !matches(file,args)) throw Error("Ярлык с таким именем уже существует");
    if (!shell.writeShortcutLink(file,fs.existsSync(file) ? "update" : "create",properties)) throw Error("Не удалось записать ярлык");
    written.add(file.toLowerCase());
  }
  for (const file of previous) if (!written.has(file.toLowerCase())) fs.rmSync(file,{force:true});
  return true;
}
module.exports={install,remove,ownedLinks};

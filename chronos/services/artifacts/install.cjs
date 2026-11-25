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
    return path.resolve(shortcut.target).toLowerCase() === path.resolve(process.execPath).toLowerCase() && shortcut.args === args;
  } catch {return false;}
}
function install(id,metadata,iconData) {
  if (process.platform !== "win32") throw Error("Ярлыки доступны в Windows");
  const png=nativeImage.createFromDataURL(iconData);
  if (png.isEmpty() || png.getSize().width !== 64 || png.getSize().height !== 64) throw Error("Некорректный значок");
  const icons=path.join(app.getPath("userData"),"artifact-icons");
  fs.mkdirSync(icons,{recursive:true});
  const icon=path.join(icons,id+".ico");
  fs.writeFileSync(icon,iconFile(png.toPNG()));
  const args="--chronos-artifact="+id;
  const stem=metadata.title.replace(/[<>:"/\\|?*\x00-\x1f]/g,"_").slice(0,80).trim().replace(/[. ]+$/,"") || "Артефакт";
  const name=/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(stem) ? "_"+stem : stem;
  const properties={target:process.execPath,args,icon,iconIndex:0,description:metadata.description.slice(0,240),
    appUserModelId:"io.github.zulut30.chronos.artifact."+id};
  for (const dir of [app.getPath("desktop"),path.join(app.getPath("appData"),"Microsoft","Windows","Start Menu","Programs","Chronos")]) {
    fs.mkdirSync(dir,{recursive:true});
    let file=path.join(dir,name+".lnk");
    if (fs.existsSync(file) && !matches(file,args)) file=path.join(dir,name+" ("+id+").lnk");
    if (fs.existsSync(file) && !matches(file,args)) throw Error("Ярлык с таким именем уже существует");
    if (!shell.writeShortcutLink(file,fs.existsSync(file) ? "update" : "create",properties)) throw Error("Не удалось записать ярлык");
  }
  return true;
}
module.exports={install};

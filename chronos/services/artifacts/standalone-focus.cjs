const {createHash} = require("node:crypto");
const net = require("node:net");
const {uuid} = require("./policy.mjs");

// The shortcut-only process releases the desktop profile lock so the full app can open later.
// While both are running the full app can focus a window already owned by that process.
function pipe(profile) {
  const key = createHash("sha256").update(profile.toLowerCase()).digest("hex").slice(0,32);
  return "\\\\.\\pipe\\chronos-artifact-focus-" + key;
}
function listen(profile,focus) {
  const server = net.createServer(socket => {
    let line = "";
    socket.setTimeout(3000,()=>socket.destroy());
    socket.setEncoding("utf8");
    socket.on("error",()=>socket.destroy());
    socket.on("data",async chunk => {
      line+=chunk;
      if (line.length>160) {socket.destroy();return;}
      if (!line.endsWith("\n")) return;
      socket.removeAllListeners("data");
      try {
        const {id,version} = JSON.parse(line);
        const ok = uuid.test(id) && (version === undefined || Number.isSafeInteger(version) && version > 0);
        socket.end(ok && await focus(id,version) ? "1" : "0");
      } catch {socket.end("0");}
    });
  });
  // The installed shortcut already owns its Electron profile lock.
  server.on("error",()=>{if (server.listening) server.close();});
  server.listen(pipe(profile));
  return server;
}
function focusExisting(profile,id,version) {
  return new Promise((resolve,reject) => {
    const socket = net.connect(pipe(profile));
    let reply = "";
    socket.setTimeout(4500,()=>socket.destroy(Error("Окно артефакта не ответило")));
    socket.on("connect",()=>socket.write(JSON.stringify({id,version})+"\n"));
    socket.on("data",bytes=>{reply+=bytes.toString();});
    socket.on("end",()=>resolve(reply==="1"));
    socket.on("error",error=>{
      if (error.code==="ENOENT" || error.code==="ECONNREFUSED") resolve(false);
      else reject(error);
    });
  });
}
module.exports = {listen,focusExisting};

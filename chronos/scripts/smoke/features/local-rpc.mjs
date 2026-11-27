// Evaluated in the packaged renderer using its authenticated local connection.
export function smokeRpc(tag, payload) {
  const socket = window.__olyStudio.ws;
  const id = String(800000000 + Math.floor(Math.random() * 9000000));
  return new Promise((resolve, reject) => {
    let buffer = "";
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener("message", receive);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(Error(tag + " timed out"));
    }, 15000);
    function receive(event) {
      if (typeof event.data !== "string") return;
      if (event.data.charCodeAt(0) === 30) {
        buffer += event.data.slice(1);
        return;
      }
      const raw = buffer + event.data;
      buffer = "";
      if (!raw.includes(id)) return;
      for (const message of [JSON.parse(raw)].flat()) {
        if (message._tag !== "Exit" || String(message.requestId) !== id) continue;
        cleanup();
        if (message.exit._tag === "Success") resolve(message.exit.value);
        else reject(Error(tag + " failed"));
      }
    }
    socket.addEventListener("message", receive);
    socket.send(JSON.stringify({ _tag: "Request", id, tag, payload, headers: [] }));
  });
}

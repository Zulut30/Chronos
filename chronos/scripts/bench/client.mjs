import { once } from "node:events";

export async function openSocket(url) {
  const socket = new WebSocket(url);
  await once(socket, "open", { signal: AbortSignal.timeout(10000) });
  return socket;
}

export async function rpcClient(url) {
  const socket = await openSocket(url);
  const requests = new Map();
  let next = 0;
  let failure;
  const send = (message) => socket.send(JSON.stringify(message));
  socket.onmessage = ({ data }) => {
    for (const message of [JSON.parse(data)].flat()) {
      const { requestId, exit, values } = message;
      const handler = requests.get(String(requestId));
      if (!handler) continue;
      if (message._tag === "Chunk") {
        try { for (const value of values) handler.item?.(value); }
        catch (error) { failure = error; }
        send({ _tag: "Ack", requestId });
      } else if (message._tag === "Exit") {
        requests.delete(String(requestId));
        if (exit._tag === "Success") handler.resolve?.(exit.value);
        else {
          const error = Error(handler.tag + ": " + JSON.stringify(exit.cause).slice(0, 1500));
          if (handler.reject) handler.reject(error);
          else failure = error;
        }
      }
    }
  };
  const request = (tag, payload, handler) => {
    const id = String(++next);
    requests.set(id, { tag, ...handler });
    send({ _tag: "Request", id, tag, payload, headers: [] });
  };
  return {
    call: (tag, payload) => Promise.race([
      new Promise((resolve, reject) => request(tag, payload, { resolve, reject })),
      new Promise((_, reject) => setTimeout(() => reject(Error(tag + " timed out")), 90000).unref()),
    ]),
    stream: (tag, payload, item) => request(tag, payload, { item }),
    check() { if (failure) throw failure; if (socket.readyState !== WebSocket.OPEN) throw Error("RPC closed"); },
    close: () => socket.close(),
  };
}

export async function connectCdp(url) {
  const socket = await openSocket(url);
  let next = 0;
  const pending = new Map();
  const listeners = new Set();
  socket.onmessage = ({ data }) => {
    const event = JSON.parse(data);
    const { id, result, error } = event;
    if (event.method) for (const listener of listeners) listener(event);
    const reply = pending.get(id);
    if (!reply) return;
    pending.delete(id);
    clearTimeout(reply.timer);
    error ? reply.reject(Error(error.message)) : reply.resolve(result);
  };
  return {
    listen(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    call(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const id = ++next;
        const timer = setTimeout(() => { pending.delete(id); reject(Error("CDP timed out: " + method)); }, 12000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params, sessionId }));
      });
    },
    close: () => socket.close(),
  };
}

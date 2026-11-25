// Token-free ACP fixture for a real, disposable desktop thread.
import { createInterface } from "node:readline";
const sessionId = "graphite-demo";
const send = (message) => console.log(JSON.stringify({ jsonrpc: "2.0", ...message }));
for await (const line of createInterface({ input: process.stdin })) {
  const { id, method } = JSON.parse(line);
  if (id == null) continue;
  let result = {};
  if (method === "initialize") {
    result = { protocolVersion: 1, agentCapabilities: {}, authMethods: [], agentInfo: { name: "Палитра", version: "1" } };
  } else if (method === "session/new") {
    result = { sessionId, models: { currentModelId: "graphite", availableModels: [{ modelId: "graphite", name: "Графит" }] } };
  } else if (method === "session/prompt") {
    send({ method: "session/update", params: { sessionId, update: {
      sessionUpdate: "agent_message_chunk", content: { type: "text",
        text: "У встроенного кода `--card` теперь своя подложка. Цвет поверхности отделяет карточку от фона." },
    } } });
    result = { stopReason: "end_turn" };
  }
  send({ id, result });
}

// Minimal local ACP workload following the handshake in apps/server/scripts/dev-replay-agent.ts.
import { createInterface } from "node:readline";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const [root, frames, interval, workload] = process.argv.slice(2);
const sessionId = crypto.randomUUID();
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
for await (const line of createInterface({ input: process.stdin })) {
  const { id, method, params } = JSON.parse(line);
  if (id == null) continue;
  let result = {};
  if (method === "initialize") {
    result = { protocolVersion: 1, agentCapabilities: {}, authMethods: [], agentInfo: { name: "chronos-bench", version: "1" } };
  } else if (method === "session/new") {
    result = { sessionId, models: { currentModelId: "bench", availableModels: [{ modelId: "bench", name: "Bench" }] } };
  } else if (method === "session/prompt") {
    const thread = JSON.stringify(params.prompt).match(/bench-([a-f0-9-]{36})/)?.[1];
    if (!thread) throw Error("Missing workload ID");
    writeFileSync(join(root, thread + ".ready"), String(process.pid));
    const seed = JSON.stringify(params.prompt).includes("SEED_HISTORY");
    const deadline = Date.now() + 150000;
    while (!seed && !existsSync(join(root, "go"))) {
      if (Date.now() > deadline) throw Error("Start barrier expired");
      await sleep(50);
    }
    let final = "";
    for (let i = 0; i < (seed ? 12 : Number(frames)); i++) {
      const marker = `MARK_${thread}_${i}_${Date.now()} ${"x".repeat(56)}\n\n`;
      const lines = seed ? 48 : i === 0 ? 96 : 2;
      const code = () => Array.from({ length: lines }, (_, j) =>
        `const value_${i}_${j} = processValue(${i}, ${j});`).join("\n");
      const text = workload !== "code" ? marker : seed
        ? marker + "```js\n" + code() + "\n```\n\n"
        : (i % 6 === 0 ? "```js\n" : "") + "// " + marker.trim() + "\n" + code() + "\n" +
          (i % 6 === 5 || i === Number(frames) - 1 ? "```\n" : "");
      final += text;
      send({ method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } } });
      if (!seed) await sleep(Number(interval));
    }
    writeFileSync(join(root, thread + ".txt"), final);
    result = { stopReason: "end_turn" };
  }
  send({ id, result });
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { dirname, basename, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

test("ACP emits distinct ordered markers after the start barrier and exits with end_turn", async () => {
  const root = await mkdtemp(join(tmpdir(), "chronos-bench-test-"));
  const id = crypto.randomUUID();
  const child = spawn(process.execPath, [join(import.meta.dirname, "agent.mjs"), root, "3", "5"], {
    stdio: ["pipe","pipe","inherit"], windowsHide: true,
  });
  const lines = createInterface({ input: child.stdout });
  const frames = [];
  lines.on("line", (line) => frames.push(JSON.parse(line)));
  try {
    child.stdin.write(JSON.stringify({ id: 1, method: "session/prompt", params: { prompt: "bench-" + id } }) + "\n");
    const deadline = Date.now() + 5000;
    while (!(await stat(join(root, id + ".ready")).catch(() => false))) {
      assert(Date.now() < deadline);
      await sleep(10);
    }
    assert.equal(frames.length, 0);
    const exit = once(child, "exit", { signal: AbortSignal.timeout(5000) });
    await writeFile(join(root, "go"), "");
    child.stdin.end();
    assert.equal((await exit)[0], 0);
    assert.equal(frames.at(-1).result.stopReason, "end_turn");
    const chunks = frames.slice(0, -1).map((frame) => frame.params.update.content.text);
    assert.deepEqual(chunks.map((chunk) => chunk.match(/_(\d+)_/)[1]), ["0","1","2"]);
    assert.equal(chunks.join(""), await readFile(join(root, id + ".txt"), "utf8"));
  } finally {
    if (child.exitCode === null) child.kill();
    lines.close();
    if (dirname(resolve(root)) === resolve(tmpdir()) && basename(root).startsWith("chronos-bench-test-")) {
      await rm(root, { recursive: true, force: true, maxRetries: 3 });
    }
  }
});

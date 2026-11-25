const { test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { createController } = require("./controller.cjs");

test("policy binds refs, requires trusted approval in every mode, and cancels pending actions on stop", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "chronos-policy-"));
  const socket =
    process.platform === "win32"
      ? "\\\\.\\pipe\\chronos-test-" + randomUUID()
      : path.join(dir, "broker");
  const key = randomUUID();
  const calls = [];
  let emergency, nextApproval;
  const controller = createController({
    dir,
    tools: dir,
    socket,
    key,
    shortcut: {
      register(_, fn) {
        emergency = fn;
        return true;
      },
      unregister() {},
    },
    notify() {
      const item = controller.state().pending.at(-1);
      if (item && nextApproval) {
        const resolve = nextApproval;
        nextApproval = undefined;
        resolve(item);
      }
    },
    async native(s, op, q) {
      calls.push({ op, value: q.value });
      if (op === "snapshot")
        return [{ ref: "@sample:e1", name: "Input", role: "textfield", secure: true }];
    },
  });
  t.after(async () => {
    controller.stop();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 });
  });
  const settings = { enabled: true, all: false, apps: ["notepad.exe"], mode: "none" };
  async function request(q, auth = key) {
    const client = net.connect(socket);
    const end = once(client, "end");
    let text = "";
    client.on("data", (chunk) => {
      text += chunk;
    });
    client.on("connect", () => client.write(JSON.stringify({ key: auth, request: q }) + "\n"));
    await end;
    return text ? JSON.parse(text) : undefined;
  }
  const approval = () =>
    new Promise((resolve) => {
      nextApproval = resolve;
    });
  assert.equal(controller.state().settings.enabled, false);
  await controller.ui({ op: "configure", settings });
  assert.equal(
    await request({ op: "attach", kind: "desktop", target: "notepad.exe" }, "wrong"),
    undefined,
  );
  assert.equal((await request({ op: "attach", kind: "desktop", target: "outside.exe" })).ok, false);
  const { session } = await request({ op: "attach", kind: "desktop", target: "notepad.exe" });
  assert.equal((await request({ op: "click", session, ref: "@sample:e1" })).ok, false);
  await request({ op: "snapshot", session });
  let pending = approval();
  const fill = request({ op: "fill", session, ref: "@sample:e1", value: "from-agent" });
  const item = await pending;
  assert.equal(item.manual, true);
  assert.equal(item.proposal, undefined);
  await controller.ui({ op: "decide", id: item.id, allow: true, value: "synthetic-user-input" });
  assert.equal((await fill).ok, true);
  assert.deepEqual(calls.at(-1), { op: "fill", value: "synthetic-user-input" });
  assert.equal((await request({ op: "click", session, ref: "@sample:e1" })).ok, false);
  await request({ op: "snapshot", session });
  pending = approval();
  const click = request({ op: "click", session, ref: "@sample:e1" });
  const stopItem = await pending;
  emergency();
  await click;
  await controller.ui({ op: "decide", id: stopItem.id, allow: true });
  assert.equal(
    calls.some((c) => c.op === "click"),
    false,
  );
  assert.equal(controller.state().pending.length, 0);
  assert.equal(controller.state().settings.enabled, false);
  assert.doesNotMatch(
    await fs.readFile(path.join(dir, "history.json"), "utf8"),
    /from-agent|synthetic-user-input|notepad/,
  );
  await controller.ui({ op: "configure", settings: { ...settings, mode: "every" } });
  pending = approval();
  const attach = request({ op: "attach", kind: "desktop", target: "notepad.exe" });
  const every = await pending;
  await controller.ui({ op: "decide", id: every.id, allow: false });
  assert.equal((await attach).ok, false);
});

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { checkAvailability, createController } = require("./controller.cjs");
const { makeNative } = require("./native.cjs");

test("cold browser startup and navigation get independent IPC requests", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "chronos-cold-open-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const session = {
    kind: "web",
    id: randomUUID(),
    host: "localhost",
    target: "http://localhost:8000",
    socketDir: dir,
  };
  let launched = false;
  let navigations = 0;
  const native = makeNative(dir, dir, async (_file, args) => {
    const open = args.indexOf("open");
    if (open === -1) return { data: { url: session.target } };
    // The pinned CLI gives a navigate request 30s, including any implicit browser launch.
    const launchMs = launched ? 0 : 20_000;
    launched = true;
    const navigates = args[open + 1] === session.target;
    if (launchMs + (navigates ? 15_000 : 0) > 30_000) throw Error("daemon read timed out");
    if (navigates) navigations++;
    return {};
  });
  await native(session, "open", { target: session.target }, new AbortController().signal);
  assert.equal(navigations, 1);
});

test("policy binds refs, requires trusted approval in every mode, and cancels pending actions on stop", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "chronos-policy-"));
  const socket =
    process.platform === "win32"
      ? "\\\\.\\pipe\\chronos-test-" + randomUUID()
      : path.join(dir, "broker");
  const key = randomUUID();
  const calls = [];
  let emptyTree = false;
  let emergency, nextApproval;
  const controller = createController({
    dir,
    tools: dir,
    socket,
    key,
    shortcut: {
      register(accelerator, fn) {
        assert.equal(accelerator, "CommandOrControl+Alt+Shift+F12");
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
        return emptyTree
          ? []
          : [{ ref: "@sample:e1", name: "Input", role: "textfield", secure: true }];
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
  emptyTree = true;
  const empty = await request({ op: "snapshot", session });
  assert.deepEqual(empty.elements, []);
  assert.match(empty.message, /дереве доступности/);
  assert.equal((await request({ op: "click", session, ref: "@sample:e1" })).ok, false);
  emptyTree = false;
  await request({ op: "snapshot", session });
  let pending = approval();
  const fill = request({ op: "fill", session, ref: "@sample:e1", value: "from-agent" });
  const item = await pending;
  assert.equal(controller.state().active, true);
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
  await controller.restore();
  assert.deepEqual(controller.state().settings, { ...settings, enabled: false });
  await controller.ui({ op: "configure", settings: { ...settings, mode: "every" } });
  pending = approval();
  const attach = request({ op: "attach", kind: "desktop", target: "notepad.exe" });
  const every = await pending;
  await controller.ui({ op: "decide", id: every.id, allow: false });
  assert.equal((await attach).ok, false);
  controller.stop();
  await controller.restore();
  assert.deepEqual(controller.state().settings, { ...settings, mode: "every" });
  // Re-applying settings while already enabled must rebind the socket cleanly without EADDRINUSE.
  await controller.ui({ op: "configure", settings: { ...settings, mode: "risk" } });
  assert.equal(controller.state().settings.enabled, true);
  assert.equal(controller.state().settings.mode, "risk");
});

test("unavailable agent-desktop reports clear Russian reason and refuses enabling", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "chronos-unavail-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 });
  });
  const availability = checkAvailability(dir, "darwin");
  assert.equal(availability.available, false);
  assert.match(availability.reason, /agent-desktop/);

  const controller = createController({
    dir,
    tools: dir,
    socket: path.join(dir, "broker"),
    key: randomUUID(),
    shortcut: { register: () => true, unregister() {} },
    notify() {},
    availability,
  });
  t.after(() => controller.stop());

  assert.equal(controller.state().available, false);
  assert.equal(controller.state().unavailableReason, availability.reason);
  await assert.rejects(
    controller.ui({ op: "configure", settings: { enabled: true, all: false, apps: [], mode: "risk" } }),
    /agent-desktop/,
  );
  assert.equal(controller.state().settings.enabled, false);
});

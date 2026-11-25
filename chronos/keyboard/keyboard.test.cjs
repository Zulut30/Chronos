const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const model = require("../skills/chronos-keyboard/scripts/profile.cjs");
const { session } = require("./session.cjs");
const { attach } = require("./desktop.cjs");

const signal = "mi_01:key-3f-0-74";
const other = "mi_00-col03:consumer-e9";
const pad = "a".repeat(64);
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chronos-pad-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, db: model.store(root) };
}
test("version 1 migrates, profiles round trip independently; invalid data never replaces an existing profile", (t) => {
  const { db } = temporary(t);
  assert.equal(db.state().enabled, false);
  assert.deepEqual(db.names(), [{ id: "default", name: "Основной" }]);
  db.save({
    version: 1,
    id: "two",
    name: "Другой",
    bindings: { key1: { signal, action: "tasks" } },
  });
  assert.equal(db.load("two").version, 2);
  assert.deepEqual(db.load("two").bindings.key1.action, { id: "tasks" });
  assert.deepEqual(db.load("default").bindings, {});
  assert.throws(() => db.save({ ...db.load("two"), version: 9 }));
  assert.throws(() => db.load("../two"));
  assert.equal(db.names().length, 2);
});
test("AI proposals preserve learned signals and revision; reject duplicate gestures, unknown positions and OS targets", (t) => {
  const { db } = temporary(t);
  db.save({ ...model.initial(), bindings: { key5: { signal, action: null } } });
  const p = model.plan(db, {
    key5: { id: "draft", arg: "Claude" },
    "upper-right": { id: "volume-up" },
  });
  assert.equal(p.base, model.revision(db.load("default")));
  assert.equal(p.profile.bindings.key5.signal, signal);
  assert.equal(db.load("default").bindings.key5.action, null);
  assert.throws(() =>
    model.profile({
      ...p.profile,
      bindings: { ...p.profile.bindings, key1: { signal } },
    }),
  );
  assert.throws(() => model.plan(db, { key10: { id: "tasks" } }));
  assert.throws(() =>
    model.plan(db, { key1: { id: "url", arg: "file:///test" } }),
  );
  assert.throws(() =>
    model.plan(db, { key1: { id: "program", arg: "test.bat /user" } }),
  );
});
test("only learned inputs dispatch, OS grants include the action target and native volume is not doubled", () => {
  const p = model.profile({
    ...model.initial(),
    bindings: {
      key1: { signal, action: { id: "url", arg: "https://example.com/" } },
      "upper-right": { signal: other, action: { id: "volume-up" } },
    },
  });
  const grants = Object.entries(p.bindings).map(([s, b]) =>
    model.grantKey(p, s, b.action),
  );
  assert.equal(model.mapped(p, "mi_01:key-1e-0-41", grants), null);
  assert.equal(model.mapped(p, signal, []), null);
  assert.equal(model.mapped(p, signal, grants).arg, "https://example.com/");
  p.bindings.key1.action.arg = "https://different.example/";
  assert.equal(model.mapped(p, signal, grants), null);
  assert.equal(model.mapped(p, other, grants), null);
});
test("every catalog action maps a learned key with its parameters and required grant", () => {
  for (const id of Object.keys(model.actions)) {
    const arg = {draft:"Claude", url:"https://example.com/", program:"C:\\Tools\\player.exe"}[id];
    const action = model.action(arg ? {id, arg} : {id});
    const p = model.profile({...model.initial(), bindings: {key5: {signal, action}}});
    if (model.osAction(id)) assert.equal(model.mapped(p,signal,[]),null,id);
    assert.deepEqual(model.mapped(p,signal,[model.grantKey(p,"key5",action)]),action,id);
  }
});
test("child lifetime follows switch, selected path, focus and removal; stale output is ignored", () => {
  const children = [],
    signals = [];
  const s = session(
    () => {
      const child = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        kill() {
          this.killed = true;
        },
      });
      children.push(child);
      return child;
    },
    (v) => signals.push(v),
    () => {},
  );
  s.sync(false, pad, true);
  s.sync(true, null, true);
  s.sync(true, pad, false);
  s.sync(true, pad, true, false);
  assert.equal(s.status(), "absent");
  assert.equal(children.length, 0);
  s.sync(true, pad, true);
  s.sync(true, pad, true);
  assert.equal(children.length, 1);
  children[0].stdout.write("ready\n" + signal + "\n");
  assert.deepEqual(signals, [signal]);
  s.sync(false, pad, true);
  assert.equal(children[0].killed, true);
  children[0].stdout.write(signal + "\n");
  s.sync(true, pad, true);
  children[0].emit("exit", 0);
  children[1].stdout.write("absent\n");
  children[1].emit("exit", 0);
  assert.equal(s.status(), "absent");
  s.sync(true, pad, true);
  children[2].stdout.write("ready\n");
  s.sync(true, pad, false);
  assert.equal(children[2].killed, true);
  assert.deepEqual(signals, [signal]);
});
test("desktop broker asks for new OS assignments; denial and stale plans preserve the original profile", async (t) => {
  const { db, root } = temporary(t);
  const win = Object.assign(new EventEmitter(), {
    webContents: new EventEmitter(),
    getNativeWindowHandle: () => Buffer.alloc(8),
    isFocused: () => true,
    isDestroyed: () => false,
  });
  win.webContents.send = () => {};
  let response = 0,
    dialogs = 0;
  const request = attach({
    win,
    root,
    model,
    trusted: () => true,
    dialog: {
      showMessageBox: async () => {
        dialogs++;
        return { response };
      },
    },
  });
  const before = await request("open");
  const created = await request("create", "Для записи");
  const renamed = await request("rename", { base: created.revision, name: "Для монтажа" });
  assert.equal(renamed.current.id, created.current.id);
  assert.equal(db.load(created.current.id).name, "Для монтажа");
  await assert.rejects(request("delete", created.revision), /изменился/);
  assert.equal((await request("delete", renamed.revision)).current.id, created.current.id);
  response = 1;
  const removed = await request("delete", renamed.revision);
  assert.equal(removed.current.id, "default");
  assert.deepEqual(db.names(), before.profiles);
  assert.equal(db.state().active, "default");
  await assert.rejects(request("delete", removed.revision), /Основной/);
  response = 0;
  dialogs = 0;
  const proposal = model.plan(db, { key1: { id: "volume-up" } });
  await assert.rejects(request("save", proposal));
  assert.deepEqual(db.load("default"), before.current);
  response = 1;
  const saved = await request("save", proposal);
  assert.equal(dialogs, 2);
  await assert.rejects(request("save", proposal));
  await request("save", { base: saved.revision, profile: saved.current });
  assert.equal(dialogs, 2);
  await request("close");
  await assert.rejects(request("learn", "key1"));
  win.emit("closed");
});

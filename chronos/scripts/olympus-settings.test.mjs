import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { assemblePrologue, settingsFeatureAsset, settingsFeatureFiles, standaloneFeature } from "../../apps/web/src/chronos/olympus/featureAssets.ts";
import { featureIds, featureKey } from "../../apps/web/src/chronos/olympus/featureFlags.ts";
import { choiceValue, followsChat, modelFilter, preferenceKeys as keys, writeFeature, writePreference } from "../../apps/web/src/chronos/olympus/chatPreferences.ts";

const dir = new URL("../../apps/web/src/chronos/olympus/", import.meta.url);
const read = (path) => readFileSync(new URL(path, dir), "utf8");
const imports = read("prologue.ts");
const files = [...imports.matchAll(/import "(.*?)";/g)].map((m) => m[1]);

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("emitted prologue contains every module's exact bytes once, in release order", () => {
  const asset = Buffer.from(assemblePrologue(imports, read));
  let end = 0;
  for (const file of files) {
    const original = readFileSync(new URL(file, dir));
    const start = asset.indexOf(original);
    assert.ok(start >= end, file);
    assert.equal(asset.indexOf(original, start + 1), -1, file);
    end = start + original.length;
  }
  for (const file of ["15-lang-icons.js", "88-rich-markdown.chat.js"]) {
    const bytes = readFileSync(new URL("features/" + file, dir));
    assert.ok(Buffer.from(standaloneFeature(file, bytes.toString("utf8"))).includes(bytes));
  }
});

test("settings code loads separately with the exact release bytes and no import-time effects", async () => {
  const main = assemblePrologue(imports, read);
  const asset = settingsFeatureAsset(read);
  for (const name of settingsFeatureFiles) {
    const original = read("features/" + name);
    assert.ok(!main.includes(original), name);
    assert.ok(asset.includes(original), name);
  }
  const { mount } = await import("data:text/javascript," + encodeURIComponent(asset));
  assert.equal(typeof mount, "function");
});

test("feature settings affect the next window, protect core and enforce the notification dependency", () => {
  const localStorage = storage();
  const main = assemblePrologue(imports, (file) => `ran.push(${JSON.stringify(file)});\n`);
  const launch = () => {
    const context = { localStorage, ran: [] };
    runInNewContext(main, context);
    return context;
  };
  assert.deepEqual(launch().ran, files);
  for (const id of featureIds) writeFeature(localStorage, id, false);
  localStorage.setItem(featureKey("05-oly-core"), "0");
  const disabled = launch();
  assert.deepEqual(disabled.ran, files.filter((file) => !featureIds.some((id) => file.endsWith("/" + id + ".js"))));
  assert.equal(disabled.__olyPlanMode("default", "thread-id"), "default");
  assert.equal(disabled.__olyPlanMode("plan", "thread-id"), "plan");
  writeFeature(localStorage, "26-notifications", true);
  assert.equal(launch().ran.includes("./features/26-notifications.js"), false);
  writeFeature(localStorage, "22-budget", true);
  assert.ok(launch().ran.includes("./features/26-notifications.js"));
  writeFeature(localStorage, "15-lang-icons", true);
  const icons = standaloneFeature("15-lang-icons.js", "globalThis.icons = true;");
  runInNewContext(icons, disabled);
  assert.equal(disabled.icons, undefined);
  assert.ok(runInNewContext(icons + "\nicons", { localStorage }));
});

test("both markdown entry points receive no pre/post plugins when rich text is off, even when loaded before main", async () => {
  const localStorage = storage();
  // Use an isolated ESM worker so each import has a fresh window snapshot.
  const { Worker } = await import("node:worker_threads");
  const source = standaloneFeature("88-rich-markdown.chat.js", read("features/88-rich-markdown.chat.js"));
  for (const on of [false, true]) {
    writeFeature(localStorage, "88-rich-text", on);
    const data = localStorage.getItem(featureKey("88-rich-text"));
    const worker = new Worker(new URL("data:text/javascript," + encodeURIComponent(`
      import { parentPort } from 'node:worker_threads';
      globalThis.localStorage = { getItem: key => key === "chronos.olympus.88-rich-text" ? ${JSON.stringify(data)} : null };
      const { richMarkdown } = await import(${JSON.stringify("data:text/javascript," + encodeURIComponent(source))});
      parentPort.postMessage([typeof richMarkdown?.pre, typeof richMarkdown?.post]);
    `)));
    const result = await new Promise((resolve, reject) => {
      worker.once("message", resolve);
      worker.once("error", reject);
    });
    assert.deepEqual(result, on ? ["function", "function"] : ["undefined", "undefined"]);
  }
});

test("unavailable storage keeps Olympus defaults", () => {
  const source = assemblePrologue(imports, (file) => `ran.push(${JSON.stringify(file)});\n`);
  const context = { get localStorage() { throw new Error("denied"); }, ran: [] };
  runInNewContext(source, context);
  assert.deepEqual(context.ran, files);
});

test("native preferences round-trip in Olympus formats and keep panel layout data", () => {
  const store = storage();
  writePreference(store, keys.downloads, "t3");
  assert.equal(store.getItem(keys.downloads), "t3");
  writePreference(store, keys.downloads, "auto");
  assert.equal(store.getItem(keys.downloads), null);
  writePreference(store, keys.notifications, "silent");
  assert.equal(store.getItem(keys.notifications), "silent");
  assert.equal(choiceValue("unknown", ["all", "silent"]), "all");
  writePreference(store, keys.modelFilter, "speech");
  assert.equal(store.getItem(keys.modelFilter), '"speech"');
  assert.equal(modelFilter(store.getItem(keys.modelFilter)), "speech");
  assert.equal(modelFilter("bad JSON"), null);
  for (const [key, value] of [[keys.taskMode, "plan"], [keys.taskBoard, "0"], [keys.taskWorktree, "1"], [keys.taskAutostart, "0"]]) {
    writePreference(store, key, value);
    assert.equal(store.getItem(key), value);
  }
  assert.equal(followsChat("invalid"), true);
  const layout = { split: { a: "side-chat:b" }, ratio: { a: 0.3 }, future: 7 };
  store.setItem(keys.follow, JSON.stringify(layout));
  writePreference(store, keys.follow, "0");
  assert.deepEqual(JSON.parse(store.getItem(keys.follow)), { ...layout, follow: false });
  let calls = 0;
  const panels = { state: { P: { follow: false } }, toggleFollow() {
    this.state.P.follow = !this.state.P.follow;
    calls++;
  } };
  writePreference(store, keys.follow, "1", panels);
  writePreference(store, keys.follow, "1", panels);
  assert.equal(calls, 1);
});

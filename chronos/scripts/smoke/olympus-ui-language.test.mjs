import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { waitForFooter } from "./features/sidebar-footer.mjs";
import { featureBlock } from "../../../apps/web/src/chronos/olympus/featureAssets.ts";
import { localizeEntryHtml } from "../../../apps/web/src/chronos/olympus/l10n/englishBundle.ts";
import { installEnglish } from "../../services/ui-language/english.mjs";

test("both saved languages choose their renderer before preloading, and Russian skips the English setup", async () => {
  const input = '<link rel="modulepreload" href="/shared.js"><script type="module" src="/main.js"></script>';
  const html = localizeEntryHtml(input, "/english.js", ["en", "ru"]);
  const script = html.match(/<script type="module">([\s\S]+)<\/script>/)[1];
  for (const [saved, expected] of [[{}, "ru"], [{ language: "ru" }, "ru"], [{ language: "en" }, "en"]]) {
    const loads = [], preloads = [];
    let reads = 0;
    const window = { desktopBridge: { getClientSettings() { reads++; return Promise.resolve(saved); } } };
    const document = { documentElement: {}, createElement: () => ({}), head: { append: link => preloads.push(link.href) } };
    const load = async name => { loads.push(name); return { imports: { "/shared.js": "/en-shared.js" } }; };
    await runInNewContext("(async () => {" + script.replaceAll("import(", "load(") + "})()", { window, document, load });
    assert.equal(reads, 1);
    assert.equal(document.documentElement.lang, expected);
    assert.deepEqual(loads, expected === "en" ? ["/english.js", "/main.js"] : ["/main.js"]);
    assert.deepEqual(preloads, [expected === "en" ? "/en-shared.js" : "/shared.js"]);
  }
});

test("every artifact gallery label has an English translation", () => {
  const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
  const labels = json("../../l10n/artifacts.ru.json");
  const { exact } = json("../../services/ui-language/olympus-en.json");
  for (const [key, russian] of Object.entries(labels)) {
    assert.ok(exact[russian], key + ": " + russian);
    assert.doesNotMatch(exact[russian], /\p{Script=Cyrillic}/u, key);
  }
});

test("footer measurements survive a renderer swap and still report unrelated errors", async () => {
  const footer = { width: 281 };
  const samples = [new Error("CDP Runtime.evaluate error: Inspected target navigated or closed"), null, footer];
  const result = await waitForFooter(() => {
    const value = samples.shift();
    if (value instanceof Error) throw value;
    return value;
  }, { interval: 0 });
  assert.deepEqual(result, footer);
  assert.deepEqual(samples, []);
  await assert.rejects(waitForFooter(() => { throw new Error("invalid selector"); }), /invalid selector/);
});

test("English translator and 24-thread-details keep limits labels and durations free of Cyrillic", () => {
  const catalog = JSON.parse(readFileSync(new URL("../../services/ui-language/olympus-en.json", import.meta.url), "utf8"));
  const fakeWindow = { confirm: x => x };
  fakeWindow.top = fakeWindow;
  const fakeDocument = {
    body: { nodeType: 1, closest: () => null, getAttributeNames: () => [] },
    documentElement: {},
    addEventListener() {},
    querySelectorAll: () => [],
    createTreeWalker: () => ({ nextNode: () => false }),
  };
  const globals = {
    window: fakeWindow,
    document: fakeDocument,
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    MutationObserver: class { observe() {} },
    HTMLIFrameElement: class {},
  };
  const saved = Object.fromEntries(Object.keys(globals).map(k => [k, globalThis[k]]));
  Object.assign(globalThis, globals);
  try {
    installEnglish(catalog);
    const t = fakeWindow.__chronosEnglishText;
    assert.equal(t("5 д 2 ч"), "5 d 2 h");
    assert.equal(t("2 ч 59 мин"), "2 h 59 min");
    assert.equal(t("3 д"), "3 d");
    assert.equal(t("4 ч"), "4 h");
    assert.equal(t("15 мин"), "15 min");
    assert.equal(t("Лимиты"), "Limits");
    assert.equal(t("сброс · осталось"), "reset · remaining");
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete globalThis[k];
      else globalThis[k] = v;
    }
  }

  const block = featureBlock("24-thread-details.js", "globalThis.ranRussian = true;");
  const enContext = { __chronosShellLanguage: "en" };
  runInNewContext(block, enContext);
  assert.equal(enContext.ranRussian, undefined);
  assert.equal(enContext.__olyThreadDetails.shortLabel("Weekly"), "Weekly");
  assert.equal(enContext.__olyThreadDetails.dur((5 * 24 + 2) * 3600_000), "5 d 2 h");
  assert.equal(enContext.__olyThreadDetails.dur((2 * 60 + 59) * 60_000), "2 h 59 min");
  assert.equal(enContext.__olyThreadDetails.rowAria("Weekly: 68% left", "5 d 2 h"), "Weekly: 68% left, resets in 5 d 2 h");
  assert.equal(
    enContext.__olyThreadDetails.rowDetail({ threadId: "child", edge: { sourceThreadId: "parent", kind: "subagent", status: "running" } }),
    "Subagent · running",
  );
  for (const out of [
    enContext.__olyThreadDetails.shortLabel("Weekly"),
    enContext.__olyThreadDetails.dur((5 * 24 + 2) * 3600_000),
    enContext.__olyThreadDetails.dur((2 * 60 + 59) * 60_000),
  ]) {
    assert.doesNotMatch(out, /\p{Script=Cyrillic}/u);
  }
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { waitForFooter } from "./features/sidebar-footer.mjs";
import { localizeEntryHtml } from "../../../apps/web/src/chronos/olympus/l10n/englishBundle.ts";

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

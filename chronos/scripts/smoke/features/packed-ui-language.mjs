// Quotas, missed runs and approvals need provider state. Verify their actual call sites
// in the renderer selected by the English import map, plus the packaged Russian GT output.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { packedEntries } from "../packed-entries.mjs";

const messageIds = [
  "7cd354570f9e8e68", "9cca3054224a1637", "a9d9eb4b919f9f92", "02e86b138ee62faf",
  "e3adedbb19f4f3c8", "cc5b5b737ee87aa8", "799d74fdf16baa66", "5aaf55ebc6d75c3e",
  "8dfffc716ee299a3", "6c65fcd2980c7d68", "51660ea573583eb0", "a9ff74720000da9f",
];
const catalogs = new URL("../../../../apps/web/src/i18n/translations/", import.meta.url);
const source = locale => JSON.parse(readFileSync(new URL(locale + ".json", catalogs), "utf8"));
const prefix = "apps/server/dist/client";

export async function verifyPackedLanguage(archive) {
  const en = source("en"), ru = source("ru");
  const byPath = predicate => packedEntries(archive, name => name.startsWith(prefix + "/assets/") && predicate(name.slice(prefix.length)));
  const [setup] = byPath(name => /\/chronos-english-[a-f0-9]{16}\.js$/.test(name));
  assert.ok(setup, "English bootstrap missing");
  const imports = JSON.parse(setup[1].toString().match(/^export const imports = (.+);$/m)[1]);
  const [russian] = byPath(name => /\/ru-[\w-]+\.js$/.test(name));
  assert.ok(russian, "Russian GT catalog missing");
  const shipped = (await import("data:text/javascript;base64," + russian[1].toString("base64"))).default;
  const missing = new Set(messageIds);
  for (const id of messageIds) {
    assert.doesNotMatch(en[id], /\p{Script=Cyrillic}/u, id);
    assert.match(ru[id], /\p{Script=Cyrillic}/u, id);
    assert.equal(shipped[id], ru[id], en[id] + " in the shipped Russian catalog");
  }
  // GT renders English from each component's fallback. Exclude locale/dictionary
  // assets and shadowed Russian modules, which could otherwise mask a broken fallback.
  const locales = /^\/assets\/(?:de|en|es|fr|ja|ko|pt-BR|ru|sv|zh)-[\w-]{8}\.js$/;
  for (const [, bytes] of byPath(name => name.endsWith(".js") && !Object.hasOwn(imports, name) &&
      !locales.test(name) && !/\/assets\/(?:chronos-english|olympus)-/.test(name))) {
    const js = bytes.toString().replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    for (const id of missing) if (js.includes(en[id])) missing.delete(id);
    if (!missing.size) break;
  }
  assert.deepEqual([...missing].map(id => en[id]), [], "missing fallbacks in the selected English renderer");
  console.log("Verified both languages for " + messageIds.length + " Chronos GT messages in the package");
}

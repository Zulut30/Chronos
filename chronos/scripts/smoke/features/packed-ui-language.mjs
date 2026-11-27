// Quotas, missed runs and approvals need provider state. Verify their actual call sites
// in the renderer selected by the English import map, plus the packaged Russian GT output.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { packedEntries } from "../packed-entries.mjs";

const messageIds = [
  "7cd354570f9e8e68", "9cca3054224a1637", "a9d9eb4b919f9f92", "02e86b138ee62faf",
  "e3adedbb19f4f3c8", "cc5b5b737ee87aa8", "799d74fdf16baa66", "5aaf55ebc6d75c3e",
  "8dfffc716ee299a3", "6c65fcd2980c7d68", "51660ea573583eb0", "a9ff74720000da9f",
  // Settings host, permission editor, desktop updates and resource controls.
  "a72840dfe8e970d9", "e3f68dbc01ed4523", "8777e39ee8671853", "9bcdaccd10e44823",
  "18df706e68f42ea9", "ce19cbab7a347f89", "71095a868b04dec4", "2ea30a7383d16882",
  "be79ac42a5bf4774", "e23795dd567a0bb4", "06402f8d5a03c7d7", "91ad768bf4bccd93",
  "2b8162af67805b3e", "600f38865f001011", "e25d5bf096a8021d", "62ad23bde638a5b7",
  "85cf1c541e45555e", "2bc8bf19019c1f09", "d5a40d094ba8bdbd", "4a0aa4ecbfc2b24b",
  "faa4000e1c497144", "d83cace50e3e192e", "71e585a136f5fb5f",
  "83ea1465d91cdb34", "724baefb1716842b", "7d8b45e99bf2992b", "8086b36e6d582ff9",
  "77bc7873d636e9b6", "286158b26812f4b9", "5298649c8f9acbda", "b2be70822d55f16a",
  "8ff5295ac69cb51d", "b994ceff7a59b4f0", "616eeb4b920ecf0b", "3433b1de49b7e93e",
  "0699bc3ac93c5c4e", "506705376c24c857", "a171b7e4fc651336", "6857566b35bdfc48",
  "a99e69dce82e3b0f", "92a45cd40283156f", "53284105a7423abf", "a560fd7a855648e6",
  "091ed640e9c9fbb7", "87846c5910d14aa7", "1b694b2d5f43f68b", "c251d5fb6872abff",
  "80ccfa40778a0de0",
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
  const [settingsAsset] = byPath(name => /\/olympus-settings-[a-f0-9]{16}\.js$/.test(name));
  assert.ok(settingsAsset, "Missing immutable lazy Olympus settings resource");
  const resource = settingsAsset[0].split("/").at(-1);
  const lazyImport = new RegExp("import\\(\\s*(['\"`])\\.\\/" + resource.replaceAll(".", "\\.") + "\\1\\s*\\)");
  const lazyOwners = new Map();
  for (const [file, bytes] of byPath(name => name.endsWith(".js") && !name.includes("/olympus-"))) {
    if (bytes.includes(resource)) lazyOwners.set(file.slice(prefix.length), bytes.toString());
  }
  for (const locale of ["ru", "en"]) {
    assert.ok([...lazyOwners].some(([file, js]) => {
      const selected = locale === "en" ? !Object.hasOwn(imports, file) : !Object.values(imports).includes(file);
      return selected && lazyImport.test(js);
    }), "Settings must load the immutable panels on demand in " + locale);
  }
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

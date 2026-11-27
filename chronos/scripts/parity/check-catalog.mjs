import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { olympusCatalog } from "../../../apps/web/src/chronos/olympus/l10n/catalog.ts";

const root = NodePath.resolve(import.meta.dirname, "../../../apps/web");
const dir = NodePath.join(root, "src/i18n/translations");
const en = JSON.parse(NodeFS.readFileSync(NodePath.join(dir, "en.json"), "utf8"));
const plugin = olympusCatalog();
plugin.configResolved({ root });
const ru = JSON.parse(plugin.load.call({ addWatchFile() {}, info() {} }, NodePath.join(dir, "ru.json")));
const reviewedFile = NodePath.resolve(root, "../../chronos/l10n/gt-reviewed-identical.json");
const identical = {};
const missing = [];
for (const [id, source] of Object.entries(en)) {
  if (!Object.hasOwn(ru, id) || ru[id] === null || (ru[id] === "" && source !== "")) missing.push([id, source]);
  else if (JSON.stringify(source) === JSON.stringify(ru[id]) && /[a-z]/i.test(JSON.stringify(source))) identical[id] = source;
}
if (process.argv.includes("--write")) NodeFS.writeFileSync(reviewedFile, JSON.stringify(identical, null, 2) + "\n");
else {
  const reviewed = JSON.parse(NodeFS.readFileSync(reviewedFile, "utf8"));
  for (const [id, source] of Object.entries(identical)) {
    if (JSON.stringify(source) !== JSON.stringify(reviewed[id])) missing.push([id, source]);
  }
}
for (const [id, source] of missing) {
  console.error("Olympus ru.json", id, JSON.stringify(source));
  process.exitCode = 1;
}
console.log(Object.keys(en).length, "GT messages checked after Olympus overrides");

// Read the installed CI artifact offline. Only the subsequent CDP smoke launches its renderer.
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { assemblePrologue, settingsFeatureAsset, standaloneFeature } from "../../../apps/web/src/chronos/olympus/featureAssets.ts";
import { packedEntries } from "./packed-entries.mjs";

const prefix = "apps/server/dist/client/assets/";
const dir = path.resolve(import.meta.dirname, "../../../apps/web/src/chronos/olympus");
const read = file => fs.readFileSync(path.join(dir, file), "utf8");
const raw = new Map([
  ["main", assemblePrologue(read("prologue.ts"), read)],
  ["settings", settingsFeatureAsset(read)],
  ["pierre", standaloneFeature("15-lang-icons.js", read("features/15-lang-icons.js"))],
  ["markdown", standaloneFeature("88-rich-markdown.chat.js", read("features/88-rich-markdown.chat.js"))],
].map(([id, text]) => {
  const bytes = Buffer.from(text);
  const digest = createHash("sha256").update(bytes).digest("hex");
  return ["olympus-" + id + "-" + digest.slice(0, 16) + ".js", bytes];
}));
const shims = new Set(["entities-BYt4Kx9w.js", "rightPanelStore-BKC7Sf3u.js", "react-BP46yLMB.js", "jsx-runtime-BQExFN_X.js"]);
const runtime = Buffer.from(read("l10n/runtime-translator.js"));
const rows = JSON.parse(fs.readFileSync(new URL("./host-seams.json", import.meta.url), "utf8"));
function compiledToken(row) {
  if (row.compiled) return row.compiled;
  if (row.marker.startsWith("dataset.")) return row.marker.split(" ")[0];
  const slot = row.selector.match(/^\[data-slot="(.+)"\]$/);
  if (slot) return slot[1];
  const token = row.selector.match(/^\[([\w-]+)\]$/);
  if (token) return token[1];
  if (/^[.#]/.test(row.selector)) return row.selector.slice(1);
  throw Error("Missing compiled form for " + row.selector);
}
const pending = rows.map(row => ({ row, token: compiledToken(row) }));
let hosts = 0;
for (const [file, bytes] of packedEntries(process.argv[2], key => key.startsWith(prefix) && key.endsWith(".js"))) {
  const name = file.slice(prefix.length);
  if (/^olympus-(?:main|settings|pierre|markdown)-[0-9a-f]{16}\.js$/.test(name)) {
    if (!raw.get(name)?.equals(bytes)) throw Error("Olympus asset differs from checkout: " + name);
    raw.delete(name);
    continue;
  }
  shims.delete(name);
  // Raw legacy code and the runtime dictionary can themselves mention a missing host selector.
  const at = bytes.indexOf(runtime);
  if (at !== -1) hosts++;
  const js = (at === -1 ? bytes : Buffer.concat([bytes.subarray(0, at), bytes.subarray(at + runtime.length)])).toString("utf8");
  for (let i = pending.length - 1; i >= 0; i--) {
    if (js.includes(pending[i].token)) pending.splice(i, 1);
  }
}
for (const [name] of raw) console.error("Missing Olympus module asset:", name);
for (const shim of shims) console.error("Missing 93-chat-panels shim:", shim);
for (const { row, token } of pending) console.error("Missing installed host seam:", row.modules.join(", "), row.selector, row.owner, token);
if (hosts !== 1) console.error("Expected one exact runtime-translator/DICT block. Found", hosts);
if (raw.size || shims.size || pending.length || hosts !== 1) process.exitCode = 1;
else console.log("Installed archive verified:", rows.length, "native host markers, 4 immutable assets, 4 panel shims, runtime translator");

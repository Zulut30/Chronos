import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { closeSync, createReadStream, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { createRequire, SourceMap } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";

import { olympusL10n } from "../../../apps/web/src/chronos/olympus/l10n/plugin.ts";
import { checkCoverage, contextFile, loadTables, newCounts, readDictionaries, remaining, tableNames, translateChunk } from "../../../apps/web/src/chronos/olympus/l10n/translate.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const data = join(root, "chronos/l10n");
const reference = readJSON(join(root, "chronos/parity/l10n-4774.json"));
const expectedCounts = readJSON(join(data, "expected-4774.json"));
const rawTables = readDictionaries(data);
const tables = loadTables(data, process.argv[2] === "--generate-contexts" ? {} : undefined);
async function verifierParser() {
  if (process.env.CHRONOS_L10N_ACORN) {
    const { parse } = createRequire(import.meta.url)(process.env.CHRONOS_L10N_ACORN);
    return (js) => parse(js, { ecmaVersion: "latest", sourceType: "module" });
  }
  const vite = createRequire(join(root, "apps/web/package.json")).resolve("vite");
  return (await import(pathToFileURL(vite).href)).parseAst;
}
const parse = await verifierParser();
const counts = newCounts();
const inventoryCounts = newCounts();
const prefix = "apps/server/dist/client/assets/";
const isClientJS = (path) => path.startsWith(prefix) && path.endsWith(".js");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const runtime = readFileSync(join(root, "apps/web/src/chronos/olympus/l10n/runtime-translator.js"));
const seen = new Set();
let literalFiles = 0, mixedFiles = 0, projected = 0, additional = 0, archiveChunks = 0;

function readJSON(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// Inventory offsets are UTF-8 bytes. JS RegExp reports UTF-16 offsets in each of the two passes.
function characterOffsets(bytes, ranges) {
  const offsets = new Map();
  let byte = 0, char = 0;
  for (const end of [...new Set(ranges.flat())].sort((a, b) => a - b)) {
    assert.ok(end >= byte && end <= bytes.length);
    char += bytes.toString("utf8", byte, end).length;
    offsets.set(end, char);
    byte = end;
  }
  return offsets;
}

function afterPass(offset, edits) {
  let delta = 0;
  for (const { start, end, length } of edits) {
    if (offset <= start) break;
    assert.ok(offset >= end, "inventory boundary inside a replacement");
    delta += length - (end - start);
  }
  return offset + delta;
}

function stripRanges(text, ranges) {
  const parts = [];
  let previous = 0;
  for (const [start, end] of ranges.toSorted((a, b) => a[0] - b[0])) {
    assert.ok(start >= previous && end >= start && end <= text.length);
    parts.push(text.slice(previous, start));
    previous = end;
  }
  return parts.join("") + text.slice(previous);
}

function verifyFile(path, clean, live, record) {
  const golden = reference.files[path];
  const original = clean.toString("utf8");
  const { code, edits, unresolved } = isClientJS(path) ? translateChunk(original, path, tables, counts, parse) : { code: original, edits: [], unresolved: [] };
  checkCoverage(unresolved, true, console.warn);
  const applied = edits.length;
  if (applied) checkCoverage(remaining(code, path, tables, parse), true, console.warn);

  if (!golden) {
    assert.equal(applied, 0, "Unexpected translation outside the inventory: " + path);
    return;
  }
  seen.add(path);
  const native = golden.nativeCleanBytes ?? [];
  const localizations = record?.hunks.filter((h) => h.kind === "localization") ?? [];
  const offsets = characterOffsets(clean, [...native, ...localizations.map((h) => h.clean)]);
  const outputOffset = (byte) => afterPass(offsets.get(byte), edits);
  const outputRange = (range) => range.map(outputOffset);

  if (live) {
    assert.equal(sha(clean), record.before.sha256, path + " clean");
    assert.equal(sha(live), record.after.sha256, path + " LIVE");
    assert.deepEqual(native, record.hunks.filter((h) => h.kind === "native").map((h) => h.clean));
    assert.equal(golden.localizations, localizations.length);
    for (const h of localizations) {
      const before = clean.toString("utf8", ...h.clean);
      const after = live.toString("utf8", ...h.live);
      assert.equal(before, h.before);
      assert.equal(after, h.after);
      assert.equal(code.slice(...outputRange(h.clean)), after, path + " " + h.clean);
      inventoryCounts[h.table][before] = (inventoryCounts[h.table][before] ?? 0) + 1;
    }
  }
  if (native.length) {
    // Drop exactly the measured native spans on both sides. Only mixed files may have
    // later LF->CRLF conversions. Additional LIVE blocks and their glue have no clean bytes.
    const result = stripRanges(code, native.map(outputRange)).replaceAll("\r\n", "\n");
    assert.equal(sha(result), golden.sha256, path + " outside native ranges");
    if (live) {
      const cuts = [...record.blocks.map((b) => [b.start, b.end]), ...record.glue,
        ...record.hunks.filter((h) => h.kind === "native").map((h) => h.live)];
      const chars = characterOffsets(live, cuts);
      const target = stripRanges(live.toString("utf8"), cuts.map((range) => range.map((byte) => chars.get(byte))))
        .replaceAll("\r\n", "\n");
      assert.ok(result === target, path + " outside native ranges, LIVE");
    }
    mixedFiles++;
  } else {
    const bytes = Buffer.from(code);
    assert.equal(sha(bytes), golden.sha256, path);
    if (live) assert.ok(bytes.equals(live), path + " byte equality");
    literalFiles++;
  }
  projected += golden.localizations;
  additional += applied - golden.localizations;
}

function verifyInventory(dir) {
  const inventory = readJSON(join(dir, "inventory.json"));
  assert.equal(inventory.tag, reference.tag);
  assert.equal(inventory.archives["server.asar"].clean.sha256, reference.serverAsarSha256);
  for (const record of inventory.differences) {
    const read = (side) => readFileSync(join(dir, "extract", side, record.archive, record.path));
    assert.ok(Object.hasOwn(reference.files, record.path), record.path);
    verifyFile(record.path, read("clean"), read("live"), record);
  }
  const block = inventory.verbatim_blocks.find((b) => b.name === "runtime-translator.js");
  const liveMain = readFileSync(join(dir, "extract/live/server.asar", block.archive_path));
  assert.ok(liveMain.subarray(block.start, block.end).equals(runtime));
  assert.equal(block.end, liveMain.length);
  assert.ok(liveMain.subarray(block.start - 120, block.start).includes("//# sourceMappingURL="));
  assert.ok(readFileSync(join(dir, block.dictionary.verbatim)).equals(liveMain.subarray(block.dictionary.start, block.dictionary.end)));
  for (const table of tableNames) {
    assert.deepEqual({ ...inventoryCounts[table] }, expectedCounts[table], table + " inventory counts");
  }
}

// Unpack packed JS directly into memory, one file at a time. No Electron, package install,
// archive execution or unpacked native modules are needed for the client comparison.
async function verifyOfficialHash(path) {
  const hash = createHash("sha256");
  for await (const part of createReadStream(path)) hash.update(part);
  assert.equal(hash.digest("hex"), reference.serverAsarSha256, "official server.asar");
}

function* archiveFiles(path, includeMixed = false) {
  const fd = openSync(path, "r");
  function read(offset, size) {
    const bytes = Buffer.alloc(size);
    let done = 0;
    while (done < size) {
      const n = readSync(fd, bytes, done, size - done, offset + done);
      assert.ok(n > 0, "truncated asar");
      done += n;
    }
    return bytes;
  }
  try {
    const header = read(0, 16);
    assert.equal(header.readUInt32LE(0), 4);
    assert.equal(header.readUInt32LE(4), header.readUInt32LE(8) + 4);
    const contents = 8 + header.readUInt32LE(4);
    const tree = JSON.parse(read(16, header.readUInt32LE(12)).toString("utf8"));
    function* walk(entries, parent) {
      for (const [name, entry] of Object.entries(entries)) {
        const key = parent + name;
        if (entry.files) {
          yield* walk(entry.files, key + "/");
        } else if (isClientJS(key) || includeMixed && Object.hasOwn(reference.files, key)) {
          assert.ok(!entry.unpacked && entry.offset !== undefined, key);
          const bytes = read(contents + Number(entry.offset), entry.size);
          assert.equal(sha(bytes), entry.integrity.hash, key + " archive integrity");
          yield [key, bytes];
        }
      }
    }
    yield* walk(tree.files, "");
  } finally {
    closeSync(fd);
  }
}

function verifyLiteralContexts() {
  const js = [
    'const messages = {children:`Merge this ${render({label:"Threads",',
    '  value: `nested ${arg}`})} (${branch?.name})`, label: "Threads", value:"Threads",',
    'title:"ACP Registry", message:"Action", "0000000000000001":"Threads"};',
    'const language = "Git Commit Message"; export {language as "0000000000000002"};',
    'if (messages.label === "Threads") log("Threads");',
  ].join("\n");
  const expected = js.replace("Merge this ${render", "Слить (${branch?.name}): ${render")
    .replace("})} (${branch?.name})", "})}").replace('label: "Threads"', 'label: "Треды"');
  const result = translateChunk(js, "repartitioned.js", tables, newCounts(), parse);
  assert.equal(result.code, expected);
  assert.deepEqual(result.unresolved, []);
  assert.deepEqual(remaining(result.code, "repartitioned.js", tables, parse), []);
}

// Drive the registered build hooks with renamed output files. No Vite build or browser required.
function verifyHooks() {
  const web = join(root, "apps/web");
  const plugin = olympusL10n();
  plugin.configResolved({ root: web });
  plugin.buildStart.call({ addWatchFile() {} });
  const original = "const jsx={label:`Accent color`}; events.push('main');\n//# sourceMappingURL=x.map";
  const makeBundle = () => ({
    "a.js": {
      type: "chunk", fileName: "a.js", moduleIds: [join(web, "src/main.tsx")], code: original, sourcemapFileName: "x.map",
      // Two mappings: start of file and "events" at UTF-16 column 34.
      map: { version: 3, sources: ["src.tsx"], names: [], mappings: "AAAA,kCAAC", toString() { return JSON.stringify(this); } },
    },
    "index.html": { type: "asset", fileName: "index.html", source: '<script type="module" src="/a.js"></script>' },
    "x.map": { type: "asset", fileName: "x.map", source: "" },
    "b.js": { type: "chunk", fileName: "b.js", moduleIds: [], code: "const unrelated = 1;" },
  });
  const warnings = [];
  const emitted = new Map();
  const hooks = { parse, emitFile(asset) { emitted.set(asset.fileName, asset.source); }, info() {}, warn: (s) => warnings.push(s), error: (s) => { throw new Error(s); } };
  const generate = (bundle) => plugin.generateBundle.handler.call(hooks, { sourcemap: true }, bundle);
  const strict = process.env.CHRONOS_L10N_STRICT;
  try {
    delete process.env.CHRONOS_L10N_STRICT;
    const bundle = makeBundle();
    generate(bundle);
    assert.deepEqual(warnings, []);
    assert.ok(bundle["a.js"].code.includes("label:`" + rawTables.label["Accent color"] + "`"));
    assert.ok(bundle["a.js"].code.endsWith("//# sourceMappingURL=x.map\n" + runtime));
    assert.equal(bundle["b.js"].code, "const unrelated = 1;");
    assert.ok([...emitted.entries()].some(([file, source]) => file.includes("/en-a-") && source.includes("Accent color")));
    assert.match(bundle["index.html"].source, /__chronosInitialLanguage/u);
    const map = new SourceMap(JSON.parse(bundle["x.map"].source));
    const moved = bundle["a.js"].code.indexOf("events.push");
    assert.notEqual(moved, 34);
    assert.equal(map.findEntry(0, moved - 1).originalColumn, 0);
    assert.equal(map.findEntry(0, moved).originalColumn, 1);
    const events = [];
    runInNewContext(bundle["a.js"].code, {
      events, document: { body: null }, MutationObserver: class {},
      addEventListener(event) { events.push(event); },
    });
    assert.deepEqual(events, ["main", "DOMContentLoaded"]);
    process.env.CHRONOS_L10N_STRICT = "1";
    generate(bundle);
    assert.deepEqual(warnings, []);
    assert.equal(bundle["a.js"].code.indexOf(runtime), bundle["a.js"].code.lastIndexOf(runtime));
    const unknown = makeBundle();
    unknown["worker.js"] = { type: "asset", fileName: "worker.js", source: 'const o={children:`Merge this ${kind} (${branch})`, customField:`Git Commit Message`};' };
    assert.throws(() => generate(unknown), /worker\.js@\d+ broad "Git Commit Message"/u);
    assert.ok(unknown["worker.js"].source.includes("Слить (${branch}): ${kind}"));
    delete process.env.CHRONOS_L10N_STRICT;
    generate(unknown);
    assert.match(warnings[0], /customField:`Git Commit Message`/u);
  } finally {
    if (strict === undefined) delete process.env.CHRONOS_L10N_STRICT;
    else process.env.CHRONOS_L10N_STRICT = strict;
  }
}

const [mode, path, ...rest] = process.argv.slice(2);
const withMissLog = mode === "--client" && rest.length === 2 && rest[0] === "--misses";
if (!path || (rest.length && !withMissLog) || !["--inventory", "--asar", "--client", "--generate-contexts"].includes(mode)) {
  throw new Error("Expected --inventory <inventory-dir>, --asar <official-asar>, --generate-contexts <official-asar>, or --client <installed-asar>");
}
assert.equal(sha(runtime), reference.runtimeSha256);
const dict = runtime.toString("utf8").match(/^const DICT=(.*?);const D=new Map/m)?.[1];
assert.ok(dict && sha(dict) === reference.dictionarySha256, "embedded LIVE DICT");
if (mode === "--client") {
  const audit = withMissLog ? (await import("../../l10n/compile-contexts.mjs")).auditMissLog(readFileSync(rest[1], "utf8"), tables, rawTables) : undefined;
  const findings = [], second = newCounts();
  let changed = 0, again = 0, hosts = 0;
  for (const [file, bytes] of archiveFiles(path)) {
    const input = bytes.toString("utf8");
    const first = translateChunk(input, file, tables, counts, parse);
    audit?.inspect(file, input, first.edits);
    const next = translateChunk(first.code, file, tables, second, parse);
    archiveChunks++;
    if (input.endsWith(runtime)) { hosts++; assert.ok(first.code.endsWith(runtime), "runtime bytes"); }
    if (first.code !== input) changed++;
    if (next.code !== first.code) again++;
    findings.push(...next.unresolved);
    for (const { start, end, key, table } of next.edits) findings.push({ file, offset: start, key, table,
      context: first.code.slice(Math.max(0, start - 70), end + 70), reason: "English on repeat" });
  }
  assert.equal(hosts, 1, "exactly one untouched Olympus runtime");
  console.log(tableNames.map((t) => t + "=" + Object.values(counts[t]).reduce((a, b) => a + b, 0)).join(", "));
  console.log(`${archiveChunks} client JS assets, ${changed} changed in memory, ${findings.length} remaining, ${again} changed on repeat.`);
  checkCoverage(findings, true, console.warn);
  assert.equal(again, 0);
  audit?.verify();
} else if (mode === "--generate-contexts") {
  await verifyOfficialHash(path);
  const { compileContexts, formatContexts } = await import("../../l10n/compile-contexts.mjs");
  function* files() { for (const [f, b] of archiveFiles(path)) yield [f, b.toString("utf8")]; }
  writeFileSync(join(data, contextFile), formatContexts(compileContexts(files(), rawTables, tables, parse)));
} else {
  if (mode === "--inventory") verifyInventory(path);
  else {
    await verifyOfficialHash(path);
    for (const [file, bytes] of archiveFiles(path, true)) {
      if (isClientJS(file)) archiveChunks++;
      verifyFile(file, bytes);
    }
  }
  assert.equal(seen.size, Object.keys(reference.files).length);
  assert.equal(literalFiles, 118);
  assert.equal(mixedFiles, 13);
  assert.equal(projected, 5152);
  assert.equal(additional, 1, "clean broad translation inside the composer's native N03");
  verifyLiteralContexts();
  verifyHooks();
  console.log("118 complete files, 13 outside native spans, 5152 static replacements + 1 under native N03; runtime, DICT, idempotence and build hooks verified.");
  if (archiveChunks) console.log("Checked all " + archiveChunks + " official client JS assets.");
}

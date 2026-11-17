#!/usr/bin/env node
// Resolves the Chronos build version from chronos/version.json.
//   upstream: the upstream T3 nightly version main is merged at (tag v<upstream> in pingdotgg/t3code)
//   revision: Chronos release counter on top of that upstream nightly (reset to 1 after a sync)
// The Chronos version is `<upstream>.chronos.<revision>`; release tags are `chronos-v<version>`.
//
//   node chronos/scripts/chronos-version.mjs                 print JSON
//   node chronos/scripts/chronos-version.mjs --check-tag T   fail unless T == chronos-v<version>
//   node chronos/scripts/chronos-version.mjs --github-output also append version/upstream/tag to $GITHUB_OUTPUT
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { upstream, revision } = JSON.parse(readFileSync(join(root, "chronos/version.json"), "utf8"));
const match = /^(\d+\.\d+\.\d+)-nightly\.(\d{8})\.(\d+)$/.exec(upstream ?? "");
if (!match) throw new Error(`chronos/version.json: upstream "${upstream}" is not an upstream nightly version`);
if (!Number.isInteger(revision) || revision < 1) throw new Error("chronos/version.json: revision must be an integer >= 1");

const version = `${upstream}.chronos.${revision}`;
const result = { upstream, revision, version, tag: `chronos-v${version}` };

const args = process.argv.slice(2);
const tagIndex = args.indexOf("--check-tag");
if (tagIndex !== -1) {
  const tag = args[tagIndex + 1];
  if (tag !== result.tag) {
    console.error(`Tag ${tag} does not match chronos/version.json (expected ${result.tag}).`);
    process.exit(1);
  }
}
if (args.includes("--github-output")) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) throw new Error("GITHUB_OUTPUT is not set");
  appendFileSync(output, `version=${version}\nupstream=${upstream}\ntag=${result.tag}\n`);
}
console.log(JSON.stringify(result));

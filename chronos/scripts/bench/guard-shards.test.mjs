import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { collectShards } from "./guard-shards.mjs";
import shards from "./guard-shards.json" with { type: "json" };

test("the comparator receives one complete same-VM series per scenario from the exact pair", t => {
  const root = mkdtempSync(join(tmpdir(), "chronos-shards-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pair = { name: "test", base: { sha: "a", run: 12 }, head: { sha: "b", run: 13 }, harnessSha: "b" };
  const output = join(root, "guard");
  for (const [group, scenarios] of Object.entries(shards)) {
    const dir = join(root, "samples-test-" + group); mkdirSync(dir);
    writeFileSync(join(dir, "pair.json"), JSON.stringify(pair));
    for (const side of ["base", "head"]) for (const round of [1, 2, 3]) for (const scenario of scenarios)
      writeFileSync(join(dir, `${side}-${round}-${scenario}.json`), "{}");
  }
  collectShards(root, output, pair);
  assert.equal(readdirSync(output).length, 55);
  assert.throws(() => collectShards(root, output, { ...pair, harnessSha: "c" }), /Different pair/);
  const sample = join(root, "samples-test-runtime", "head-3-unused.json");
  writeFileSync(sample + ".failed", "timeout");
  assert.throws(() => collectShards(root, output, pair), /Incomplete/);
  rmSync(sample + ".failed"); rmSync(sample);
  assert.throws(() => collectShards(root, output, pair), /Incomplete/);
});

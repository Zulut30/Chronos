import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import shards from "./guard-shards.json" with { type: "json" };
import budget from "../../perf-budget.json" with { type: "json" };

export function collectShards(root, output, expected) {
  const scenarios = Object.values(shards).flat();
  assert.deepEqual(scenarios.toSorted(), [...new Set(Object.keys(budget.rules).map(k => k.split(".")[0]))].sort());
  mkdirSync(output, { recursive: true });
  for (const [name, group] of Object.entries(shards)) {
    const src = join(root, "samples-" + expected.name + "-" + name);
    assert.deepEqual(JSON.parse(readFileSync(join(src, "pair.json"), "utf8")), expected, "Different pair or harness in " + name);
    const expectedFiles = [];
    for (const side of ["base", "head"]) for (let round = 1; round <= budget.rounds; round++) {
      for (const scenario of group) expectedFiles.push(`${side}-${round}-${scenario}.json`);
    }
    const actual = readdirSync(src).filter(f => /^(base|head)-/.test(f));
    assert.deepEqual(actual.sort(), expectedFiles.sort(), "Incomplete or unexpected samples in " + name);
    for (const file of expectedFiles) copyFileSync(join(src, file), join(output, file));
  }
  writeFileSync(join(output, "pair.json"), JSON.stringify(expected, null, 2));
}

if (import.meta.main) collectShards(process.argv[2], process.argv[3], {
  ...JSON.parse(process.env.PAIR), harnessSha: process.env.GITHUB_SHA,
});

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compare, evaluate } from "./guard-compare.mjs";

test("relative noise, absolute limits and zero process tolerance", () => {
  const time = { delta: 5, relative: 0.1, max: 113 };
  assert(compare(time, 100, 110));
  assert(!compare(time, 100, 111));
  assert(!compare(time, 112, 114));
  assert(!compare({ delta: 0 }, 8, 9));
  assert(!compare({ direction: "min", delta: 3, min: 47 }, 49, 46));
  assert(!compare(time, null, 100));
});

test("requires all three valid rounds including benchmark postconditions", t => {
  const dir = mkdtempSync(join(tmpdir(), "guard-compare-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const budget = { rounds: 3, rules: { "ui8.timeline.fps": { direction: "min", delta: 3 } } };
  for (const side of ["base", "head"]) {
    [54, 57, 52].forEach((fps,i) => writeFileSync(join(dir, side + "-" + (i+1) + "-ui8.json"), JSON.stringify({ timeline: { fps } })));
  }
  assert.equal(evaluate(dir, budget)[0].after, 54);
  const file = join(dir, "head-2-ui8.json");
  writeFileSync(file + ".failed", "postcondition");
  assert.equal(evaluate(dir, budget)[0].pass, false);
  rmSync(file);
  assert.equal(evaluate(dir, budget)[0].after, null);
});

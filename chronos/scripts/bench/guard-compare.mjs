import assert from "node:assert/strict";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function compare(rule, before, after) {
  if (![before, after].every(Number.isFinite)) return false;
  const allowance = Math.max(rule.delta, Math.abs(before) * (rule.relative ?? 0));
  return rule.direction === "min"
    ? after >= Math.max(rule.min ?? -Infinity, before - allowance)
    : after <= Math.min(rule.max ?? Infinity, before + allowance);
}

export function evaluate(dir, budget) {
  function value(side, key) {
    const [scenario, ...path] = key.split(".");
    const values = [];
    for (let round = 1; round <= budget.rounds; round++) {
      const f = join(dir, side + "-" + round + "-" + scenario + ".json");
      if (!existsSync(f) || existsSync(f + ".failed")) return null;
      const data = JSON.parse(readFileSync(f));
      const v = path.reduce((o, k) => o?.[k], data);
      if (!Number.isFinite(v)) return null;
      values.push(v);
    }
    return values.sort((a,b) => a-b)[Math.floor(values.length / 2)];
  }
  return Object.entries(budget.rules).map(([metric, rule]) => {
    const before = value("base", metric), after = value("head", metric);
    return { metric, unit: rule.unit, before, after, pass: compare(rule, before, after) };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  const budget = JSON.parse(readFileSync(new URL("../../perf-budget.json", import.meta.url)));
  const pair = JSON.parse(readFileSync(join(dir, "pair.json")));
  const rows = evaluate(dir, budget);
  const number = n => n === null ? "нет замера" : Number(n.toFixed(2));
  const report = ["## " + pair.head.ref + " · " + pair.base.sha.slice(0,10) + " → " + pair.head.sha.slice(0,10),
    "", "| Метрика | Ед. | Было | Стало | Вердикт |", "|---|---|---:|---:|---|",
    ...rows.map(r => [r.metric, r.unit, number(r.before), number(r.after), r.pass ? "PASS" : "FAIL"].join(" | ")).map(s => "| " + s + " |"), ""].join("\n");
  console.log(report);
  writeFileSync(join(dir, "comparison.json"), JSON.stringify({ pair, rows }, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  assert(rows.length && rows.every(r => r.pass), "Budget exceeded or evidence missing (see table)");
}

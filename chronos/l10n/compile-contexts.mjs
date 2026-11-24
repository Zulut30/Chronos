// Rebuild the context exceptions from the pinned clean ASAR; the Olympus regexes are the
// historical oracle here only. Neither the plugin nor the coverage scanner uses them.
import assert from "node:assert/strict";
import { candidate, tableNames, templateShape } from "../../apps/web/src/chronos/olympus/l10n/translate.ts";
import { visitStrings } from "../../apps/web/src/chronos/olympus/l10n/contexts.ts";

const presentation = new Set('children placeholder "aria-label" ariaLabel tooltip description heading subtitle hint actionLabel confirmLabel cancelLabel buttonLabel helperText emptyText emptyMessage caption alt'.split(" "));
const keys = [...presentation, "label", "title", "text", "message", "detail", "summary"].join("|");
const body = /(?:[^\x60$\\]|\$(?!\{)|\$\{[^\x60{}]*\})*/.source;
const keyed = new RegExp("(?<![\\p{L}\\p{N}_$.])(" + keys + "):`(" + body + ")`", "gu");
const broad = new RegExp("`(" + body + ")`", "gu");

function historicalSites(code, maps) {
  const targets = new Map(), moved = [];
  if (!code.includes("jsx") || /\bas ["']?[\da-f]{16}["']?\s*,\s*[\w$]+ as ["']?[\da-f]{16}["']?\s*[,}]/u.test(code)
      || (code.includes("terminalOpen:`terminal.open`") && code.includes("serverGetConfig:`server.getConfig`"))) return targets;
  let delta = 0;
  const first = code.replace(keyed, (match, prop, en, i) => {
    const table = presentation.has(prop) ? "presentational" : prop === "label" ? "label" : "strict";
    if (!Object.hasOwn(maps[table], en)) return match;
    const ru = en.match(/^\s*/u)[0] + maps[table][en].trim() + en.match(/\s*$/u)[0];
    targets.set(i + prop.length + 1, { table, en });
    delta += ru.length - en.length;
    moved.push([i + match.length + delta, delta]);
    return prop + ":`" + ru + "`";
  });
  let j = 0;
  delta = 0;
  for (const m of first.matchAll(broad)) {
    if (!Object.hasOwn(maps.broad, m[1])) continue;
    while (j < moved.length && moved[j][0] <= m.index) delta = moved[j++][1];
    targets.set(m.index - delta, { table: "broad", en: m[1] });
  }
  return targets;
}

export function compileContexts(files, maps, dictionary, parse) {
  const groups = Object.fromEntries(tableNames.map((k) => [k, new Map()]));
  let positives = 0;
  for (const [file, code] of files) {
    const targets = historicalSites(code, maps);
    positives += targets.size;
    visitStrings(code, parse, (site) => {
      const hit = candidate(site, dictionary);
      if (!hit) return dictionary.outputs.has(JSON.stringify(site.parts));
      const { group, table } = hit;
      const target = targets.get(site.start);
      let key = null;
      if (target) {
        assert.equal(target.table, table, file + " " + target.en);
        const recipe = group.recipes.find((r) => r.key === target.en);
        key = group.recipes.find((r) => JSON.stringify([r.output, r.order, r.same]) ===
          JSON.stringify([recipe.output, recipe.order, recipe.same])).key;
        targets.delete(site.start);
      }
      const sample = { key, context: site.context(), file, start: site.start };
      if (!groups[table].has(group.key)) groups[table].set(group.key, []);
      groups[table].get(group.key).push(sample);
      return Boolean(target);
    });
    assert.equal(targets.size, 0, file + " historical translations outside ESTree sites: " + JSON.stringify([...targets].slice(0, 3)));
  }
  assert.equal(positives, 5153);
  const result = Object.fromEntries(tableNames.map((k) => [k, Object.create(null)]));
  for (const table of tableNames) {
    for (const [en, samples] of [...groups[table]].sort(([a], [b]) => a < b ? -1 : 1)) {
      const outcomes = new Set(samples.map((s) => s.key));
      const group = dictionary.index[table].get(templateShape(en));
      const outputs = new Set(group.recipes.map((r) => JSON.stringify([r.output, r.order, r.same])));
      if (table !== "broad" && !outcomes.has(null) && outputs.size === 1) continue;
      const rules = new Map();
      for (const sample of samples) {
        const context = sample.context, conditions = [[0, context[0]]];
        if (sample.key === null && context[0].startsWith(".") && context[1].startsWith("{")) conditions.push([1, context[1]]);
        let others = samples.filter((s) => s.key !== sample.key && conditions.every(([i, v]) => s.context[i] === v));
        while (others.length) {
          let best, count = others.length;
          for (let i = 1; i < context.length; i++) {
            if (!context[i]) continue;
            const matches = others.filter((s) => s.context[i] === context[i]).length;
            if (matches < count) { count = matches; best = i; }
            if (!count) break;
          }
          assert.notEqual(best, undefined, "Conflicting historical uses: " + JSON.stringify([table, en, sample.file, others[0].file]));
          conditions.push([best, context[best]]);
          others = others.filter((s) => s.context[best] === context[best]);
        }
        const rule = [sample.key === en ? true : sample.key, ...conditions];
        rules.set(JSON.stringify(rule), rule);
      }
      result[table][en] = [...rules.values()];
    }
  }
  return result;
}

export function formatContexts(rules) {
  return "{\n" + tableNames.map((table) => "  " + JSON.stringify(table) + ": {\n" +
    Object.entries(rules[table]).map(([key, entries]) => "    " + JSON.stringify(key) + ": " + JSON.stringify(entries)).join(",\n") + "\n  }").join(",\n") + "\n}\n";
}

// Optional forensic comparison to a previous CI count log. Equivalent spellings share a
// bucket only when both their literal segments and their complete output/slot recipe agree.
export function auditMissLog(log, dictionary, maps) {
  const groups = new Map(), causes = new Map();
  function signature(table, key) {
    const shape = templateShape(key);
    const recipe = dictionary.index[table].get(shape)?.recipes.find((r) => r.key === key);
    assert.ok(recipe, "Missing dictionary entry " + table + " " + key);
    return JSON.stringify([table, shape, recipe.output, recipe.order, recipe.same]);
  }
  let rows = 0, sites = 0;
  for (const [, table, actual, expected, quoted] of log.matchAll(/^(presentational|label|strict|broad) (\d+)\/(\d+) (".*")\r?$/gmu)) {
    const key = JSON.parse(quoted), id = signature(table, key);
    const bucket = groups.get(id) ?? { keys: [], expected: 0, found: 0 };
    bucket.keys.push(key);
    bucket.expected += Number(expected) - Number(actual);
    groups.set(id, bucket);
    rows++;
  }
  assert.ok(rows > 0, "Empty miss log");
  return {
    inspect(file, source, edits) {
      if (!edits.length) return;
      const old = historicalSites(source, maps);
      for (const { table, key, start, end } of edits) {
        const bucket = groups.get(signature(table, key));
        assert.ok(bucket, file + " unexpected repair: " + key);
        const renamed = !bucket.keys.includes(source.slice(start, end));
        const reason = !source.includes("jsx") ? (renamed ? "no jsx + renamed" : "no jsx") :
          renamed ? "renamed" : old.has(start - 1) ? "old core matches stored JS" : "old broad regex skipped literal";
        causes.set(reason, (causes.get(reason) ?? 0) + 1);
        bucket.found++;
        sites++;
      }
    },
    verify() {
      for (const { keys, expected, found } of groups.values()) assert.equal(found, expected, JSON.stringify(keys));
      console.log(`${rows} CI miss rows, ${groups.size} distinct recipes, all ${sites} repairs accounted for.`, Object.fromEntries(causes));
    },
  };
}

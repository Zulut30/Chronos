import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const verifier = fileURLToPath(new URL("./parity/check-bundle-translation.mjs", import.meta.url));
const projectField = 'field:`project`,label:`Project`,text:t.projectTitle';
function occurrence(chunk, context = projectField) {
  return `assets/${chunk}-abcdef.js@70 label "Project" (unrecognized or ambiguous usage) ${JSON.stringify(context)}`;
}

test("recognizes one palette project field across chunk layouts", (t) => {
  const root = mkdtempSync(join(tmpdir(), "chronos-translation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const log = join(root, "bundle.log");
  const verify = (...occurrences) => {
    writeFileSync(log, [`Remaining English occurrences: ${occurrences.length}; replacements: 1`, ...occurrences].join("\n"));
    return spawnSync(process.execPath, [verifier, log], { encoding: "utf8" });
  };
  assert.equal(verify(occurrence("threadSearch")).status, 0);
  assert.equal(verify(occurrence("projectGrouping")).status, 0);
  assert.equal(verify(occurrence("projectGrouping"), occurrence("threadSearch")).status, 1);
  assert.equal(verify(occurrence("threadSearch", 'label:`Project`,text:other')).status, 1);
  assert.equal(verify(occurrence("settings")).status, 1);
});

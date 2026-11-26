import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
export function verifyStrictReport(report) {
  const { passedChecks, totalChecks, skippedChecks, totalErrors, unexpectedEnglishPhrases } = report.summary;
  assert.ok(report.ok && totalChecks >= 16 && passedChecks === totalChecks && skippedChecks === 0 &&
    totalErrors === 0 && unexpectedEnglishPhrases.length === 0, "Incomplete strict desktop smoke");
}
if (import.meta.main) verifyStrictReport(JSON.parse(readFileSync(process.argv[2], "utf8")));

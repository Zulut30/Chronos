import assert from "node:assert/strict";
import test from "node:test";
import { effortLabel, usageNotice } from "../../apps/web/src/chronos/olympus/l10n/providerCopy.ts";

test("localizes Codex effort independently of the model name", () => {
  assert.equal(effortLabel("6.2 Sol · High", "ru"), "6.2 Sol · Высокий");
  assert.equal(effortLabel("High", "en"), "High");
});
test("localizes provider notices without changing account names or diagnostics", () => {
  assert.equal(usageNotice("Work: Codex: Could not read limits.", "ru"), "Work: Codex: Не удалось получить лимиты.");
  assert.equal(usageNotice("Codex: custom error", "ru"), "Codex: custom error");
});

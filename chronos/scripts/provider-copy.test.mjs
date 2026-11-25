import assert from "node:assert/strict";
import test from "node:test";
import { effortDetail, effortLabel, usageNotice } from "../../apps/web/src/chronos/olympus/l10n/providerCopy.ts";

import { groupProbeArgs } from "../../apps/server/src/chronos/codexProcessGroup.ts";

test("the Codex shutdown probe only queries process groups on POSIX", () => {
  assert.equal(groupProbeArgs("win32", 123), null);
  assert.deepEqual(groupProbeArgs("linux", 123), ["-g", "123"]);
  assert.deepEqual(groupProbeArgs("darwin", 123), ["-g", "123"]);
});

test("localizes Codex effort independently of the model name", () => {
  assert.equal(effortLabel("6.2 Sol · High", "ru"), "6.2 Sol · Высокий");
  assert.equal(effortLabel("High", "en"), "High");
  assert.equal(effortDetail("Medium", "ru"), "Средний");
  assert.equal(effortDetail("Max · 1M", "ru-RU"), "Максимальный · 1M");
  assert.equal(effortDetail("Medium · 1M", "en"), "Medium · 1M");
});
test("localizes provider notices without changing account names or diagnostics", () => {
  assert.equal(usageNotice("Work: Codex: Could not read limits.", "ru"), "Work: Codex: Не удалось получить лимиты.");
  assert.equal(usageNotice("Codex: Codex could not read usage (JSON-RPC -32603).", "ru"),
    "Codex: Не удалось получить данные об использовании Codex (JSON-RPC -32603).");
  assert.equal(usageNotice("Codex: custom error", "ru"), "Codex: custom error");
});

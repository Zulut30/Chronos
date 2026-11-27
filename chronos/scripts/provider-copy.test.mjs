import assert from "node:assert/strict";
import test from "node:test";
import { effortDetail, effortLabel, serverMessage, usageNotice } from "../../apps/web/src/chronos/olympus/l10n/providerCopy.ts";

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
  assert.equal(effortDetail("High · Standard", "ru"), "Высокий · Стандартный");
  assert.equal(effortDetail("Extra High Fast · Daybreak Blue", "ru"), "Очень высокий · Быстрый · Daybreak Blue");
  assert.equal(effortDetail("Ultra Ultrafast · 1M", "ru"), "Ультра · Сверхбыстрый · 1M");
  assert.equal(effortDetail("Custom Fast · Standard", "en"), "Custom Fast · Standard");
  assert.equal(effortDetail("Custom Fast", "ru"), "Custom Fast");
});
test("localizes only exact, known provider health messages in Russian", () => {
  const cursor = "Sign in with Cursor or add CURSOR_API_KEY in provider settings.";
  assert.match(serverMessage(cursor, "ru-RU"), /Войдите.*CURSOR_API_KEY/);
  assert.equal(serverMessage(cursor, "en"), cursor);
  assert.equal(serverMessage("Custom: " + cursor, "ru"), "Custom: " + cursor);
  assert.match(serverMessage("Antigravity is installed. Google account access is not checked yet.", "ru"), /ещё не проверен/);
  assert.match(serverMessage("Open Settings → Providers in this environment and sign in to this Antigravity instance with Google, then retry.", "ru"), /Настройки → Провайдеры.*войдите через Google/);
  assert.match(serverMessage("Enter a Gemini API key in the Antigravity provider settings.", "ru"), /Введите API-ключ Gemini/);
});
test("translates a user stop in the timeline and preserves custom interrupt reasons", () => {
  assert.equal(serverMessage("Stopped by user", "ru"), "По команде пользователя");
  assert.equal(serverMessage("Stopped by user", "en"), "Stopped by user");
  assert.equal(serverMessage("Stopped by user policy", "ru"), "Stopped by user policy");
});
test("localizes provider notices without changing account names or diagnostics", () => {
  assert.equal(usageNotice("Work: Codex: Could not read limits.", "ru"), "Work: Codex: Не удалось получить лимиты.");
  const claude = "Claude Code could not retrieve subscription limits. Try /usage in this account later.";
  assert.equal(usageNotice("Work · Claude 2: " + claude, "ru-RU"),
    "Work · Claude 2: Claude Code не получил лимиты подписки. Проверьте /usage в этом аккаунте позже.");
  assert.equal(usageNotice(claude, "en"), claude);
  assert.equal(usageNotice("Office · Antigravity: Update the Antigravity CLI to read account limits.", "ru"),
    "Office · Antigravity: Обновите Antigravity CLI, чтобы увидеть лимиты аккаунта.");
  assert.equal(usageNotice("Codex: Codex could not read usage (JSON-RPC -32603).", "ru"),
    "Codex: Не удалось получить данные об использовании Codex (JSON-RPC -32603).");
  assert.equal(usageNotice("Codex: custom error", "ru"), "Codex: custom error");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { rehearsalPreferences } from "./switch/rehearsal-preferences.cjs";

test("the offline switch preserves theme choices and Olympus toggles without importing connections", () => {
  const choices = {
    "t3code:theme": "olympus:dark",
    "t3code:theme-appearance-mode": "system",
    "t3code:theme-follow-system": "false",
    "t3code:theme-halves:v1": '{"light":"custom-light","dark":"olympus:dark"}',
    "chronos.olympus.20-speed": "0",
    "oly-machines-aliases": "{}",
  };
  const storage = { ...choices, "t3code:connection-catalog": "private", "session": "private",
    "chronos.olympus.10-plan-mode": "private", "t3code:environment-themes:v1": "derived palette cache" };
  const result = runInNewContext(`(${rehearsalPreferences})(localStorage)`, { localStorage: storage });
  assert.deepEqual(Object.fromEntries(result), choices);
  for (const value of ['null', '[]', '{"dark":"https://example.invalid"}', '{"endpoint":"private"}', 'invalid']) {
    assert.deepEqual(rehearsalPreferences({ "t3code:theme-halves:v1": value }), []);
  }
});

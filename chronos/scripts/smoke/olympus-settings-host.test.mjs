import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { assemblePrologue, settingsFeatureAsset, settingsFeatureFiles } from "../../../apps/web/src/chronos/olympus/featureAssets.ts";

const dir = new URL("../../../apps/web/src/chronos/olympus/", import.meta.url);
const read = (path) => readFileSync(new URL(path, dir), "utf8");

test("settings code loads separately with the exact release bytes and no import-time effects", async () => {
  const main = assemblePrologue(read("prologue.ts"), read);
  const asset = settingsFeatureAsset(read);
  for (const name of settingsFeatureFiles) {
    const original = read("features/" + name);
    assert.ok(!main.includes(original), name);
    assert.ok(asset.includes(original), name);
  }
  const { mount } = await import("data:text/javascript," + encodeURIComponent(asset));
  assert.equal(typeof mount, "function");
});

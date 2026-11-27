import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { assemblePrologue, settingsFeatureAsset, settingsFeatureFiles } from "../../../apps/web/src/chronos/olympus/featureAssets.ts";

const dir = new URL("../../../apps/web/src/chronos/olympus/", import.meta.url);
const read = (path) => readFileSync(new URL(path, dir), "utf8");

test("settings code loads separately with every byte-pinned panel and no import-time effects", async () => {
  const main = assemblePrologue(read("prologue.ts"), read);
  const asset = settingsFeatureAsset(read);
  const pins = JSON.parse(readFileSync(new URL("../../parity/feature-seams.json", import.meta.url), "utf8"));
  for (const name of settingsFeatureFiles) {
    const original = read("features/" + name);
    assert.equal(createHash("sha256").update(original).digest("hex"), pins[name].sha256, name);
    assert.ok(!main.includes(original), name);
    assert.ok(asset.includes(original), name);
  }
  const { mount } = await import("data:text/javascript," + encodeURIComponent(asset));
  assert.equal(typeof mount, "function");
});

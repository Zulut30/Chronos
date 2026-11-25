import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openArtifacts } from "./store.mjs";

test("independent clients preserve history and reject stale writes", t => {
  const home = mkdtempSync(path.join(tmpdir(), "chronos-artifacts-"));
  const a = openArtifacts(home), b = openArtifacts(home);
  t.after(() => { a.close(); b.close(); rmSync(home, { recursive: true, force: true }); });
  const input = { source: path.join(home, "demo.html"), title: "Demo page", icon: "book",
    description: "A demo.", label: "First", files: { "index.html": "one" } };
  const { id } = a.publish(input);
  assert.throws(() => b.publish(input), /conflict/);
  b.publish({ ...input, expectedVersion: 1, files: { "index.html": "two" } });
  assert.equal(a.read(id,1).files["index.html"].toString(), "one");
  assert.equal(a.read(id).files["index.html"].toString(), "two");
  assert.equal(a.history(id).length, 2);
  assert.throws(() => a.publish({ ...input, files: { ...input.files, "../x": "bad" } }), /name/);
});

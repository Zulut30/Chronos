import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import focus from "./standalone-focus.cjs";

test("desktop reuses a shortcut host window that predates the chat", {skip:process.platform!=="win32"}, async t => {
  const profile = randomUUID(), id = randomUUID(), unknown = randomUUID();
  assert.equal(await focus.focusExisting(profile,id),false);
  const seen = [];
  const host = focus.listen(profile,(candidate,version) => {
    if (candidate!==id) return false;
    seen.push(version);
    return true;
  });
  await once(host,"listening");
  t.after(() => new Promise(resolve => host.close(resolve)));
  assert.equal(await focus.focusExisting(profile,id,2),true);
  assert.equal(await focus.focusExisting(profile,unknown),false);
  assert.deepEqual(seen,[2]);
});

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { startUpgradeMirror } from "./upgrade-mirror.mjs";

test("counts ranges, blockmaps and full responses separately and rejects invalid ranges", async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "upgrade-mirror-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const asset = path.join(dir, "installer");
  await writeFile(asset, "0123456789");
  const target = "/next.exe";
  const assets = new Map([target, target + ".blockmap"].map(name => [name, asset]));
  const mirror = await startUpgradeMirror({ assets, target, manifest: "feed" });
  t.after(mirror.close);
  const get = (pathname, init) => fetch(mirror.origin + pathname, init);
  assert.equal(await (await get("/nightly.yml")).text(), "feed");
  assert.equal((await get(target, { method: "HEAD" })).headers.get("content-length"), "10");
  const range = await get(target, { headers: { Range: "bytes=2-4" } });
  assert.equal(range.status, 206); assert.equal(range.headers.get("content-range"), "bytes 2-4/10");
  assert.equal(await range.text(), "234");
  assert.equal((await get(target, { headers: { Range: "bytes=7-10" } })).status, 416);
  assert.equal((await get("/unknown")).status, 404);
  await (await get(target + ".blockmap")).text();
  await (await get(target)).text();
  assert.deepEqual(mirror.transfer(), { rangeBytes: 3, fullBytes: 10, mapBytes: 10, manifestBytes: 4 });
});

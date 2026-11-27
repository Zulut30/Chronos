import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
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
  assert.deepEqual(mirror.transfer(), { rangeBytes: 3, fullBytes: 10, errorBytes: 0, mapBytes: 10, manifestBytes: 4 });
});

test("counts a CDN rejection and a full response to a range request by their actual status", async t => {
  const cdn = createServer((req, res) => {
    if (req.headers.range.includes(",")) res.writeHead(501).end("rejected");
    else res.writeHead(200).end("0123456789");
  });
  await new Promise(resolve => cdn.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => cdn.close(resolve)));
  const target = "/next.exe";
  const mirror = await startUpgradeMirror({ assets: new Map([[target, "proxied"]]), target, manifest: "",
    upstreamInstaller: "http://127.0.0.1:" + cdn.address().port });
  t.after(mirror.close);
  for (const range of ["bytes=1-2,4-5", "bytes=2-3"]) {
    await (await fetch(mirror.origin + target, { headers: { range } })).text();
  }
  assert.deepEqual(mirror.transfer(), { rangeBytes: 0, fullBytes: 10, errorBytes: 8, mapBytes: 0, manifestBytes: 0 });
});

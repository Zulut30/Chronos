import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { parseUpdateManifest } from "../../../scripts/lib/update-manifest.ts";
import { chronosUpdateFeed } from "../../../scripts/lib/chronos-update-feed.ts";
import { pinReleaseFeed } from "./release-feed.mjs";
import { cachedInstaller, rehearseUpdate } from "./rehearse-update.mjs";

const v = n => `0.1.12-nightly.20261124.5209.chronos.${n}`;
const name = n => `Chronos-${v(n)}-x64.exe`;
const pathname = n => `/example/Chronos/releases/download/chronos-v${v(n)}/${name(n)}`;
const digest = bytes => createHash("sha512").update(bytes).digest("base64");
const map = blocks => gzipSync(JSON.stringify({ version: "2", files: [{ name: "file", offset: 0,
  checksums: blocks.map(digest), sizes: blocks.map(b => b.length) }] }));

for (const status of [206, 501]) {
  test(`NSIS requests versioned maps and single ranges (HTTP ${status})`, async t => {
    const dir = await mkdtemp(join(tmpdir(), "chronos-delta-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const old = ["keep","old","reuse","xx"].map(v => Buffer.from(v));
    const next = [old[0], Buffer.from("new"), old[2], Buffer.from("yy")];
    const exe = Buffer.concat(next);
    await writeFile(join(dir, cachedInstaller), Buffer.concat(old));
    const raw = `version: ${v(9)}\nfiles:\n  - url: ${name(9)}\n    sha512: ${digest(exe)}\n    size: ${exe.length}\nreleaseDate: '2026-11-26'\n`;
    const feed = parseUpdateManifest(pinReleaseFeed(raw, v(9), "example/Chronos", "win"), "fixture", "Windows");
    const requests = [];
    const server = createServer((req, res) => {
      requests.push([req.method, req.url, req.headers.range]);
      if (req.url === pathname(8)+".blockmap") return res.end(map(old));
      if (req.url === pathname(9)+".blockmap") return res.end(map(next));
      if (req.url !== pathname(9)) { res.writeHead(404); return res.end(); }
      if (!req.headers.range) return res.end(exe);
      const m = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range);
      if (!m || status !== 206) { res.writeHead(501); return res.end(); }
      res.writeHead(206, { "content-range": `bytes ${m[1]}-${m[2]}/${exe.length}` });
      res.end(exe.subarray(+m[1], +m[2]+1));
    });
    await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const result = await rehearseUpdate({ directory: dir, oldVersion: v(8), manifest: feed,
      config: chronosUpdateFeed("https://github.com/example/Chronos/releases/latest/download", "nightly"),
      resolveUrl: url => new URL(url.pathname, `http://127.0.0.1:${server.address().port}`) });
    assert.ok(requests.some(r => r[1] === pathname(8)+".blockmap"));
    if (status === 206) {
      assert.equal(result.rangeBytes, 5); assert.equal(result.rangeRequests, 2);
      assert.equal(result.fullBytes, 0); assert.equal(result.fallbackReason, null);
    } else {
      assert.equal(result.fullBytes, exe.length); assert.match(result.fallbackReason, /fallback to full download.*501/i);
    }
  });
}

test("macOS keeps each architecture's ZIP and blockmaps on its immutable release", () => {
  const names = ["arm64.zip", "x64.zip", "arm64.dmg", "x64.dmg"].map(s => `Chronos-${v(9)}-${s}`);
  const raw = `version: ${v(9)}\nfiles:\n` +
    names.map(n => `  - url: ${n}\n    sha512: checksum\n    size: 42\n`).join("") +
    "releaseDate: '2026-11-26'\n";
  const pinned = pinReleaseFeed(raw, v(9), "example/Chronos", "mac");
  const files = parseUpdateManifest(pinned, "fixture", "mac").files;
  assert.deepEqual(files.map(f => f.url), names.map(n =>
    `https://github.com/example/Chronos/releases/download/chronos-v${v(9)}/${n}`));
  assert.equal(pinReleaseFeed(pinned, v(9), "example/Chronos", "mac"), pinned);
});

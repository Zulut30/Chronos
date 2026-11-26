import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { pipeline } from "node:stream/promises";

// Mirror only the two verified release assets and their blockmaps. Preserve the
// generic provider's version-to-version URL substitution and single-range requests.
export async function startUpgradeMirror({ assets, target, manifest }) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const record = { method: req.method, pathname, range: req.headers.range, bytes: 0 };
    requests.push(record);
    try {
      if (pathname === "/nightly.yml") {
        res.end(manifest);
        record.bytes = Buffer.byteLength(manifest);
        return;
      }
      const asset = assets.get(pathname);
      if (!asset || !["HEAD", "GET"].includes(req.method)) { res.writeHead(404).end(); return; }
      const { size } = await stat(asset);
      let start = 0, end = size - 1;
      if (record.range) {
        const match = /^bytes=(\d+)-(\d+)$/u.exec(record.range);
        if (!match || Number(match[1]) > Number(match[2]) || Number(match[2]) >= size) {
          res.writeHead(416).end(); return;
        }
        start = Number(match[1]); end = Number(match[2]);
        res.statusCode = 206;
        res.setHeader("content-range", `bytes ${start}-${end}/${size}`);
      }
      res.setHeader("content-length", end - start + 1);
      res.setHeader("accept-ranges", "bytes");
      if (req.method === "HEAD") { res.end(); return; }
      const file = createReadStream(asset, { start, end });
      file.on("data", chunk => { record.bytes += chunk.length; });
      await pipeline(file, res);
    } catch (error) {
      record.error = String(error);
      res.destroy();
    } finally { record.status = res.statusCode; }
  });
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  return {
    origin: "http://127.0.0.1:" + server.address().port,
    requests,
    transfer() {
      const sum = predicate => requests.filter(predicate).reduce((n, r) => n + r.bytes, 0);
      return {
        rangeBytes: sum(r => r.pathname === target && r.range),
        fullBytes: sum(r => r.pathname === target && !r.range),
        mapBytes: sum(r => r.pathname.endsWith(".blockmap")),
        manifestBytes: sum(r => r.pathname === "/nightly.yml"),
      };
    },
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }),
  };
}

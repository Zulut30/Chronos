import { readFile } from "node:fs/promises";

const assets = new Map([
  ["/chronos-ui-english.mjs", ["english.mjs", "text/javascript; charset=utf-8"]],
  ["/chronos-ui-english.json", ["olympus-en.json", "application/json; charset=utf-8"]],
]);

export async function serveLanguageAsset(path, res) {
  const asset = assets.get(path);
  if (!asset) return false;
  const body = await readFile(new URL(asset[0], import.meta.url));
  res.writeHead(200, { "Content-Type": asset[1], "Cache-Control": "no-cache" });
  res.end(body);
  return true;
}

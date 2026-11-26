// Exercise the shipped NSIS transfer logic without installing or launching Electron.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { createRequire } from "node:module";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const require = createRequire(new URL("../../../apps/desktop/package.json", import.meta.url));
const { NsisUpdater } = require("electron-updater/out/NsisUpdater.js");
const { createClient } = require("electron-updater/out/providerFactory.js");
const { CURRENT_APP_INSTALLER_FILE_NAME } = createRequire(require.resolve("electron-updater"))("builder-util-runtime");
export const cachedInstaller = CURRENT_APP_INSTALLER_FILE_NAME;

export async function rehearseUpdate({ directory, oldVersion, manifest, config, resolveUrl = url => url }) {
  const pending = path.join(directory, "pending");
  await mkdir(pending, { recursive: true });
  const output = path.join(pending, "new.exe");
  const transfer = { rangeBytes: 0, fullBytes: 0, mapBytes: 0, rangeRequests: 0, fallbackReason: null };
  const target = await resolveUrl(new URL(manifest.files[0].url));
  // Node HTTPS does not implement Electron net's redirect event. Resolve the CDN redirect once.
  const head = await fetch(target, { method: "HEAD" });
  if (!head.ok) throw Error(`Installer HEAD returned HTTP ${head.status}`);
  const downloadUrl = new URL(head.url);
  const executor = {
    createRequest(options, callback) {
      transfer.rangeRequests++;
      const transport = downloadUrl.protocol === "https:" ? https : http;
      return transport.request(downloadUrl, { headers: options.headers }, response => {
        response.on("data", chunk => { transfer.rangeBytes += chunk.length; });
        callback(response);
      });
    },
    addErrorAndTimeoutHandlers(request, reject) {
      request.on("error", reject);
      request.setTimeout(60000, () => request.destroy(Error("Range request timed out")));
    },
    async downloadToBuffer(url) {
      const response = await fetch(await resolveUrl(url));
      if (!response.ok) throw Error(`Blockmap HTTP ${response.status}: ${url.pathname}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      transfer.mapBytes += buffer.length;
      return buffer;
    },
    async download(url, destination) {
      const response = await fetch(await resolveUrl(url));
      if (!response.ok) throw Error(`Full installer HTTP ${response.status}`);
      await pipeline(response.body, async function* (chunks) {
        for await (const chunk of chunks) { transfer.fullBytes += chunk.length; yield chunk; }
      }, createWriteStream(destination));
    },
  };
  const updater = Object.create(NsisUpdater.prototype);
  Object.assign(updater, {
    app: { version: oldVersion }, httpExecutor: executor,
    downloadedUpdateHelper: { cacheDir: directory, cacheDirForPendingUpdate: pending },
    _logger: { info() {}, warn() {}, error(message) {
      if (message.includes("fallback to full download")) transfer.fallbackReason = message.split("\n")[0];
    } },
    executeDownload: ({ task }) => task(output, {}, null, async () => {}),
    verifySignature: async () => null,
  });
  const provider = createClient(config, updater, { executor, platform: "win32" });
  await updater.doDownloadUpdate({ updateInfoAndProvider: { info: manifest, provider }, disableWebInstaller: true });
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(output)) hash.update(chunk);
  assert.equal(hash.digest("base64"), manifest.files[0].sha512, "Reconstructed installer SHA-512");
  return { ...transfer, fullSize: manifest.files[0].size, receivedBytes: transfer.rangeBytes + transfer.fullBytes + transfer.mapBytes };
}

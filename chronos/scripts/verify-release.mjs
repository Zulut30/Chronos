import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { parseUpdateManifest } from "../../scripts/lib/update-manifest.ts";

const [dir, version] = process.argv.slice(2);
if (!dir || !version) throw new Error("Expected artifact directory and Chronos version");
for (const [manifestName, required] of [
  ["nightly.yml", ["x64.exe"]],
  ["nightly-mac.yml", ["arm64.zip", "x64.zip"]],
]) {
  const manifest = parseUpdateManifest(
    await NodeFSP.readFile(NodePath.join(dir, manifestName), "utf8"),
    manifestName,
    manifestName,
  );
  if (manifest.version !== version) throw new Error(`Unexpected version in ${manifestName}`);
  const expected = new Set(required.map((suffix) => `Chronos-${version}-${suffix}`));
  const allowed = new Set(expected);
  if (manifestName === "nightly-mac.yml") {
    for (const arch of ["arm64", "x64"]) allowed.add(`Chronos-${version}-${arch}.dmg`);
  }
  for (const entry of manifest.files) {
    expected.delete(entry.url);
    if (!allowed.delete(entry.url)) throw new Error(`Unexpected asset ${entry.url}`);
    const file = NodePath.join(dir, entry.url);
    if ((await NodeFSP.stat(file)).size !== entry.size) throw new Error(`Wrong size: ${entry.url}`);
    if (entry.url.endsWith(".zip")) {
      const map = await NodeFSP.stat(file + ".blockmap");
      if (!map.isFile() || !map.size) throw new Error("Missing ZIP blockmap: " + entry.url);
    }
    const hash = NodeCrypto.createHash("sha512");
    for await (const chunk of NodeFS.createReadStream(file)) hash.update(chunk);
    if (hash.digest("base64") !== entry.sha512) throw new Error(`Wrong SHA512: ${entry.url}`);
  }
  if (expected.size) throw new Error(`Missing update assets: ${[...expected].join(", ")}`);
}

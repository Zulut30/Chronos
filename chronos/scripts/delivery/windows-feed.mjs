import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { parseUpdateManifest, serializeUpdateManifest } from "../../../scripts/lib/update-manifest.ts";

// Older generic-provider clients substitute the version in BOTH the tag and the asset name.
export function pinWindowsFeed(raw, version, repo) {
  assert.match(repo, /^[\w.-]+\/[\w.-]+$/);
  assert.match(version, /^\d+\.\d+\.\d+-nightly\.\d+\.\d+\.chronos\.\d+$/);
  const manifest = parseUpdateManifest(raw, "nightly.yml", "Windows");
  const name = `Chronos-${version}-x64.exe`;
  assert.equal(manifest.version, version);
  assert.equal(manifest.files.length, 1);
  const [file] = manifest.files;
  const url = `https://github.com/${repo}/releases/download/chronos-v${version}/${name}`;
  assert.ok(file.url === name || file.url === url, "Unexpected Windows asset");
  return serializeUpdateManifest({ ...manifest, files: [{ ...file, url }],
    extras: { ...manifest.extras, path: url, sha512: file.sha512 } }, { platformLabel: "Windows" });
}

if (import.meta.main) {
  const [path, version] = process.argv.slice(2);
  await writeFile(path, pinWindowsFeed(await readFile(path, "utf8"), version, process.env.GITHUB_REPOSITORY));
}

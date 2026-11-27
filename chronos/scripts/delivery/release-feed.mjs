import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { parseUpdateManifest, serializeUpdateManifest } from "../../../scripts/lib/update-manifest.ts";

// Older generic-provider clients substitute the version in BOTH the tag and the asset name.
export function pinReleaseFeed(raw, version, repo, platform) {
  assert.match(repo, /^[\w.-]+\/[\w.-]+$/);
  assert.match(version, /^\d+\.\d+\.\d+-nightly\.\d+\.\d+\.chronos\.\d+$/);
  const manifest = parseUpdateManifest(raw, platform === "mac" ? "nightly-mac.yml" : "nightly.yml", platform);
  assert.equal(manifest.version, version);
  const suffixes = platform === "mac" ? ["arm64.zip", "x64.zip", "arm64.dmg", "x64.dmg"] : ["x64.exe"];
  const base = `https://github.com/${repo}/releases/download/chronos-v${version}/`;
  const allowed = new Set(suffixes.map(suffix => `Chronos-${version}-${suffix}`));
  const files = manifest.files.map(file => {
    const name = file.url.startsWith(base) ? file.url.slice(base.length) : file.url;
    assert.ok(allowed.delete(name), "Unexpected or duplicate release asset: " + name);
    return { ...file, url: base + name };
  });
  if (platform === "win") assert.equal(allowed.size, 0);
  const primary = files[0];
  return serializeUpdateManifest({ ...manifest, files,
    extras: { ...manifest.extras, path: primary.url, sha512: primary.sha512 } }, { platformLabel: platform });
}

if (import.meta.main) {
  const [path, version] = process.argv.slice(2);
  await writeFile(path, pinReleaseFeed(await readFile(path, "utf8"), version, process.env.GITHUB_REPOSITORY,
    path.endsWith("-mac.yml") ? "mac" : "win"));
}

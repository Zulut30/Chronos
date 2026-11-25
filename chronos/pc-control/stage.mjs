import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const assets = {
  "win-x64": [
    "x86_64-pc-windows-msvc",
    "win32-x64.exe",
    "6ee4b1e078f4e78792e79f16e32e4a78b9919464aa3c55629b7e27ed53a08c13",
    "1bf5a62ff666dddb0f8fcf45c2a4cf827b0111a37da60b5cb5cf87b22b779b21",
  ],
  "mac-arm64": [
    "aarch64-apple-darwin",
    "darwin-arm64",
    "9b7b7cfc74892eab46c2c85d6cb7dc4863bf8dab0a222cfcfb8ae4604c69c86c",
    "b762e6bfb6f5c545f5e749afdfa23c780cce586bdff8d4fcf8e61f9dabe1d9c6",
  ],
  "mac-x64": [
    "x86_64-apple-darwin",
    "darwin-x64",
    "469da10cfb68928c58caff88b92b30526e0ca895ac06bc86b7f533b1d9b309b3",
    "d2f9f81d0ea06d058d9c1ab8acb930274dad9701d04084b6abe2ade06627846d",
  ],
  "linux-x64": [
    "x86_64-unknown-linux-gnu",
    "linux-x64",
    "ca77b6b75034eeb12e537dd8c0a4f2a3424119253f38b7e6bd79ba0d2fef1264",
    "d37c722d7424055d7f352c4be35a94249e3dc712906516d82f2650fce6789c54",
  ],
  "linux-arm64": [
    "aarch64-unknown-linux-gnu",
    "linux-arm64",
    "438990a703fbeb19775596c341c3701435e80adbfa1b2f64b82ff17567d5573b",
    "51f3f45a77a49978213112c95654d448e3fe79e570ed02bb25842fb33c85610c",
  ],
};
const [platform, arch, out] = process.argv.slice(2);
const [triple, suffix, desktopHash, browserHash] = assets[platform + "-" + arch];
const tmp = await mkdtemp(path.join(tmpdir(), "chronos-cli-"));
async function download(repo, version, asset, digest, dest) {
  const url = `https://github.com/vercel-labs/${repo}/releases/download/${version}/${asset}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`${asset}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== digest)
    throw new Error("SHA256: " + asset);
  await writeFile(dest, bytes, { mode: 0o755 });
}
try {
  await mkdir(out, { recursive: true });
  const archive = path.join(tmp, "desktop.tar.gz");
  await download(
    "agent-desktop",
    "v1.3.1",
    `agent-desktop-v1.3.1-${triple}.tar.gz`,
    desktopHash,
    archive,
  );
  execFileSync("tar", ["-xf", archive, "-C", out]);
  await download(
    "agent-browser",
    "v0.44.0",
    "agent-browser-" + suffix,
    browserHash,
    path.join(out, platform === "win" ? "agent-browser.exe" : "agent-browser"),
  );
  if (platform === "win") {
    const goRoot = execFileSync("go", ["env", "GOROOT"], { encoding: "utf8" }).trim();
    await copyFile(path.join(goRoot, "LICENSE"), path.join(out, "go.LICENSE"));
    execFileSync(
      "go",
      [
        "build",
        "-trimpath",
        "-ldflags=-s -w",
        "-o",
        path.join(out, "private-desktop.exe"),
        path.join(root, "private_windows.go"),
      ],
      {
        env: { ...process.env, GOOS: "windows", GOARCH: "amd64", CGO_ENABLED: "0" },
        stdio: "inherit",
      },
    );
  }
  for (const name of [
    "agent-desktop.LICENSE",
    "agent-browser.LICENSE",
    "controller.cjs",
    "native.cjs",
  ]) {
    await copyFile(path.join(root, name), path.join(out, name));
  }
  const bin = path.join(out, "bin");
  await mkdir(bin, { recursive: true });
  for (const name of ["chronos-pc", "chronos-pc.cmd", "client.cjs"]) {
    await copyFile(path.join(root, name), path.join(bin, name));
  }
  await chmod(path.join(bin, "chronos-pc"), 0o755);
  const skill = path.join(out, "skills", "chronos-pc-control");
  await mkdir(skill, { recursive: true });
  await copyFile(
    path.join(root, "../skills/chronos-pc-control/SKILL.md"),
    path.join(skill, "SKILL.md"),
  );
} finally {
  await rm(tmp, { recursive: true, force: true });
}

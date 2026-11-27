/* oxlint-disable t3code/no-global-process-runtime -- Packaging inspects the build host and invokes macOS codesign. */
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const PLIST_BUDDY = "/usr/libexec/PlistBuddy";
const PLUTIL = "/usr/bin/plutil";
const ASAR_INTEGRITY_KEY = "Resources/app.asar";

// Standard Mach-O 32/64-bit little/big-endian magics plus universal (fat) binary magics.
const THIN_MACHO_MAGICS = new Set([0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe]);
const FAT_MACHO_MAGICS = new Set([0xcafebabe, 0xbebafeca]);

/**
 * Computes the SHA-256 hex digest of an ASAR archive's raw UTF-8 JSON header string,
 * matching Electron's `ElectronAsarIntegrity` verification (`@electron/asar` `getRawHeader`).
 */
function computeAsarHeaderHash(asarPath) {
  const fd = fs.openSync(asarPath, "r");
  try {
    const prefix = Buffer.alloc(16);
    if (fs.readSync(fd, prefix, 0, 16, 0) !== 16) {
      throw new Error(`ASAR archive is too small: ${asarPath}`);
    }
    const sizePayloadSize = prefix.readUInt32LE(0);
    const headerSize = prefix.readUInt32LE(4);
    const headerPayloadSize = prefix.readUInt32LE(8);
    const stringByteLength = prefix.readUInt32LE(12);
    if (
      sizePayloadSize !== 4 ||
      headerSize < 8 ||
      headerPayloadSize < 4 ||
      headerPayloadSize > headerSize - 4 ||
      stringByteLength === 0 ||
      stringByteLength > headerPayloadSize - 4
    ) {
      throw new Error(
        `Malformed ASAR header pickle in ${asarPath} (sizePayload=${sizePayloadSize}, headerSize=${headerSize}, payload=${headerPayloadSize}, strLen=${stringByteLength})`,
      );
    }
    const headerBuf = Buffer.alloc(stringByteLength);
    if (fs.readSync(fd, headerBuf, 0, stringByteLength, 16) !== stringByteLength) {
      throw new Error(`Truncated ASAR header in ${asarPath}`);
    }
    const parsed = JSON.parse(headerBuf.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || typeof parsed.files !== "object") {
      throw new Error(`Unexpected ASAR header JSON structure in ${asarPath}`);
    }
    return crypto.createHash("sha256").update(headerBuf).digest("hex");
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Detects whether a regular file begins with a Mach-O or universal fat binary header.
 * Distinguishes fat Mach-O (`0xcafebabe`, low arch count) from Java class files (version >= 45).
 */
function isMachOFile(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, "r");
    const header = Buffer.alloc(8);
    const bytesRead = fs.readSync(fd, header, 0, 8, 0);
    if (bytesRead < 4) return false;
    const magic = header.readUInt32BE(0);
    if (THIN_MACHO_MAGICS.has(magic)) return true;
    if (FAT_MACHO_MAGICS.has(magic) && bytesRead >= 8) {
      const nfat = magic === 0xcafebabe ? header.readUInt32BE(4) : header.readUInt32LE(4);
      return nfat >= 1 && nfat <= 32;
    }
    return false;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/**
 * Walks `rootDir` without following symlinks and returns Mach-O files ordered deepest-first.
 */
function findMachOFiles(rootDir) {
  const results = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      let stat;
      try {
        stat = fs.lstatSync(full);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        walk(full);
      } else if (stat.isFile() && isMachOFile(full)) {
        results.push(full);
      }
    }
  }
  walk(rootDir);
  return results.sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);
}

function runTool(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const stderr = error?.stderr ? `\n${String(error.stderr).trim()}` : "";
    const stdout = error?.stdout ? `\n${String(error.stdout).trim()}` : "";
    throw new Error(`${cmd} ${args.join(" ")} failed${stdout}${stderr}`, { cause: error });
  }
}

function writeAsarIntegrityPlist(infoPlistPath, hash) {
  try {
    execFileSync(PLIST_BUDDY, ["-c", "Delete :ElectronAsarIntegrity", infoPlistPath], {
      stdio: "ignore",
    });
  } catch {
    // Key was not present yet.
  }
  runTool(PLIST_BUDDY, ["-c", "Add :ElectronAsarIntegrity dict", infoPlistPath]);
  runTool(PLIST_BUDDY, [
    "-c",
    `Add :ElectronAsarIntegrity:${ASAR_INTEGRITY_KEY} dict`,
    infoPlistPath,
  ]);
  runTool(PLIST_BUDDY, [
    "-c",
    `Add :ElectronAsarIntegrity:${ASAR_INTEGRITY_KEY}:algorithm string SHA256`,
    infoPlistPath,
  ]);
  runTool(PLIST_BUDDY, [
    "-c",
    `Add :ElectronAsarIntegrity:${ASAR_INTEGRITY_KEY}:hash string ${hash}`,
    infoPlistPath,
  ]);
  runTool(PLUTIL, ["-lint", infoPlistPath]);
  const stored = runTool(PLIST_BUDDY, [
    "-c",
    `Print :ElectronAsarIntegrity:${ASAR_INTEGRITY_KEY}:hash`,
    infoPlistPath,
  ]).trim();
  if (stored !== hash) {
    throw new Error(`ElectronAsarIntegrity mismatch in ${infoPlistPath}: expected ${hash}, got ${stored}`);
  }
}

async function afterPack(context) {
  const prepareServerCompileCache = require("../../scripts/prepare-server-compile-cache.cjs");
  await prepareServerCompileCache(context);
  if (context.electronPlatformName !== "darwin") return;
  if (process.platform !== "darwin") {
    console.log("[chronos-macos] Skipping macOS ad-hoc signing on non-macOS host");
    return;
  }

  const product = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${product}.app`);
  const contentsPath = path.join(appPath, "Contents");
  const infoPlistPath = path.join(contentsPath, "Info.plist");
  const resourcesPath = path.join(contentsPath, "Resources");
  const asarPath = path.join(resourcesPath, "app.asar");

  if (!fs.existsSync(asarPath)) {
    throw new Error(`Expected packaged ASAR at ${asarPath}`);
  }

  const hash = computeAsarHeaderHash(asarPath);
  writeAsarIntegrityPlist(infoPlistPath, hash);

  // Strip stray Finder/quarantine xattrs before signing so codesign produces a clean seal.
  runTool("xattr", ["-cr", appPath]);

  // Release signing runs after electron-builder flips the fuses and signs nested code inside out.
  if (context.packager.config.forceCodeSigning) return;

  // Ad-hoc sign loose Mach-O executables and native addons in Contents/Resources/ first,
  // because `codesign --deep` only traverses standard bundle code directories.
  const looseBinaries = findMachOFiles(resourcesPath);
  for (const binary of looseBinaries) {
    runTool("codesign", ["--force", "--sign", "-", binary]);
  }

  runTool("codesign", ["--force", "--deep", "--sign", "-", appPath]);
  runTool("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
  console.log(
    `[chronos-macos] ElectronAsarIntegrity=${hash.slice(0, 12)}... signed ${looseBinaries.length} resource binary/binaries and verified ad-hoc signature for ${product}.app`,
  );
}

afterPack.computeAsarHeaderHash = computeAsarHeaderHash;
afterPack.isMachOFile = isMachOFile;
afterPack.findMachOFiles = findMachOFiles;
module.exports = afterPack;

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { computeAsarHeaderHash, findMachOFiles, isMachOFile } = require("./macos-after-pack.cjs");

function writeSyntheticAsar(filePath, headerJson) {
  const headerBytes = Buffer.from(headerJson, "utf8");
  const alignedPayloadSize = 4 + headerBytes.length + ((4 - (headerBytes.length % 4)) % 4);
  const headerSize = 4 + alignedPayloadSize;
  const buf = Buffer.alloc(8 + headerSize + 4);
  buf.writeUInt32LE(4, 0);
  buf.writeUInt32LE(headerSize, 4);
  buf.writeUInt32LE(4 + headerBytes.length, 8);
  buf.writeUInt32LE(headerBytes.length, 12);
  headerBytes.copy(buf, 16);
  fs.writeFileSync(filePath, buf);
}

test("computeAsarHeaderHash matches SHA-256 of the raw ASAR header JSON string", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chronos-asar-"));
  try {
    const asarPath = path.join(dir, "app.asar");
    const header = JSON.stringify({
      files: {
        "package.json": { size: 42, offset: "0" },
        "apps": { files: { "desktop": { files: {} } } },
      },
    });
    writeSyntheticAsar(asarPath, header);
    const expected = crypto.createHash("sha256").update(header, "utf8").digest("hex");
    assert.equal(computeAsarHeaderHash(asarPath), expected);

    const brokenPath = path.join(dir, "broken.asar");
    fs.writeFileSync(brokenPath, Buffer.from("not an asar archive"));
    assert.throws(() => computeAsarHeaderHash(brokenPath), /Malformed ASAR/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("isMachOFile and findMachOFiles recognize thin and fat Mach-O binaries while skipping non-Mach-O and symlinks", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chronos-macho-"));
  try {
    const nested = path.join(dir, "a", "b");
    fs.mkdirSync(nested, { recursive: true });

    const arm64 = path.join(nested, "agent-desktop");
    fs.writeFileSync(arm64, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01]));

    const fat = path.join(dir, "universal.dylib");
    fs.writeFileSync(fat, Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x02]));

    const javaClass = path.join(dir, "Example.class");
    fs.writeFileSync(javaClass, Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x41]));

    const script = path.join(dir, "helper.mjs");
    fs.writeFileSync(script, "export const ok = true;\n");

    assert.equal(isMachOFile(arm64), true);
    assert.equal(isMachOFile(fat), true);
    assert.equal(isMachOFile(javaClass), false);
    assert.equal(isMachOFile(script), false);

    const found = findMachOFiles(dir);
    assert.deepEqual(found, [arm64, fat]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

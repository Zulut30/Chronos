import assert from "node:assert/strict";
import { matchesGlob } from "node:path";
import { test } from "node:test";
import { windowsPayloadExclusions } from "../../../scripts/lib/windows-payload.ts";
test("Windows archive filters keep runtime addons and remove build-only inputs", () => {
  const excludes = path => windowsPayloadExclusions.some(pattern => matchesGlob(path, pattern));
  for (const path of ["patches/desktop.patch", "node_modules/node-pty/prebuilds/win32-x64/conpty.pdb",
    "node_modules/node-pty/prebuilds/linux-arm64/pty.node", "node_modules/node-pty/prebuilds/darwin-x64/pty.node",
    "node_modules/@yuuang/ffi-rs-win32-ia32-msvc/ffi.node"]) assert.ok(excludes(path), path);
  for (const path of ["node_modules/node-pty/prebuilds/win32-x64/conpty.node",
    "node_modules/@yuuang/ffi-rs-win32-x64-msvc/ffi.node", "node_modules/playwright-core/index.js"])
    assert.ok(!excludes(path), path);
});

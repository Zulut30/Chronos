const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const resources = path.join(path.dirname(process.execPath), "resources");
const server = path.join(resources, "server.asar");
const requireServer = createRequire(path.join(server, "apps/server/dist/bin.mjs"));
const pw = requireServer("playwright-core");
assert.equal(typeof pw.chromium.connectOverCDP, "function");
assert.ok(requireServer.resolve("playwright-core").startsWith(server + path.sep));
for (const file of ["app.asar/node_modules/playwright-core/package.json", "server.asar/patches",
  "server.asar/node_modules/node-pty/prebuilds/win32-x64/conpty.pdb",
  "server.asar/node_modules/node-pty/prebuilds/linux-x64/pty.node",
  "app.asar.unpacked/node_modules/@yuuang/ffi-rs-win32-ia32-msvc"]) {
  assert.equal(fs.existsSync(path.join(resources, file)), false, file);
}

import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import { packageCompatibility } from "./package-compatibility.mjs";

NodeTest.test(
  "packages only the new installer and explicit compatibility files with verifiable hashes",
  async () => {
    const temp = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "chronos-package-"));
    try {
      const installer = NodePath.join(temp, "Chronos.exe"),
        output = NodePath.join(temp, "package");
      await NodeFSP.writeFile(installer, "fixture, never executed");
      await packageCompatibility(installer, output);
      NodeAssert.deepEqual(
        (await NodeFSP.readdir(output)).sort(),
        [
          "Chronos.exe",
          "Install-Compatibility.ps1",
          "README.md",
          "SHA256SUMS.json",
          "build.json",
        "services.json",
        "sources.json",
        ].sort(),
      );
      const sums = JSON.parse(
        await NodeFSP.readFile(NodePath.join(output, "SHA256SUMS.json"), "utf8"),
      );
      for (const [file, expected] of Object.entries(sums))
        NodeAssert.equal(
          NodeCrypto.createHash("sha256")
            .update(await NodeFSP.readFile(NodePath.join(output, file)))
            .digest("hex"),
          expected,
        );
      NodeAssert.equal(
        JSON.parse(await NodeFSP.readFile(NodePath.join(output, "services.json"), "utf8")).mode,
        "retain-existing-local-services",
      );
      await NodeAssert.rejects(packageCompatibility(installer, output), /must be empty/);
      await NodeAssert.rejects(
        packageCompatibility(NodePath.join(temp, "old.asar"), NodePath.join(temp, "other")),
        /Windows installer/,
      );
    } finally {
      await NodeFSP.rm(temp, { recursive: true, force: true });
    }
  },
);

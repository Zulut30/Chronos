import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeChildProcess from "node:child_process";

const root = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "../..");
export async function packageCompatibility(installer, output) {
  if (!installer || !output)
    throw Error("Usage: --installer <new Chronos .exe> --out <empty directory>");
  if (NodePath.extname(installer).toLowerCase() !== ".exe")
    throw Error("Expected Windows installer");
  await NodeFSP.mkdir(output, { recursive: true });
  if ((await NodeFSP.readdir(output)).length) throw Error("Output directory must be empty");
  const source = NodePath.join(root, "chronos/compatibility");
  for (const name of ["services.json", "sources.json", "Install-Compatibility.ps1", "README.md"])
    await NodeFSP.copyFile(NodePath.join(source, name), NodePath.join(output, name));
  await NodeFSP.copyFile(installer, NodePath.join(output, NodePath.basename(installer)));
  const sums = {};
  for (const name of await NodeFSP.readdir(output)) {
    if (!(await NodeFSP.stat(NodePath.join(output, name))).isFile())
      throw Error("Unexpected directory in package");
    sums[name] = NodeCrypto.createHash("sha256")
      .update(await NodeFSP.readFile(NodePath.join(output, name)))
      .digest("hex");
  }
  await NodeFSP.writeFile(
    NodePath.join(output, "SHA256SUMS.json"),
    JSON.stringify(sums, null, 2) + "\n",
  );
  const head = NodeChildProcess.execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  await NodeFSP.writeFile(
    NodePath.join(output, "build.json"),
    JSON.stringify(
      {
        head,
        ...JSON.parse(await NodeFSP.readFile(NodePath.join(root, "chronos/version.json"), "utf8")),
        mode: "retain-existing-local-services",
      },
      null,
      2,
    ) + "\n",
  );
  return sums;
}
if (
  process.argv[1] &&
  NodePath.resolve(process.argv[1]) === NodeURL.fileURLToPath(import.meta.url)
) {
  const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
  if (!process.argv.includes("--installer") || !process.argv.includes("--out"))
    throw Error("Required --installer and --out");
  await packageCompatibility(NodePath.resolve(arg("--installer")), NodePath.resolve(arg("--out")));
}

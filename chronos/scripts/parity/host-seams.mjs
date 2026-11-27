import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { execFileSync } from "node:child_process";
import { globals } from "../smoke/verify-seams.mjs";

const root = NodePath.resolve(import.meta.dirname, "../../..");
const read = path => NodeFS.readFileSync(NodePath.join(root, path), "utf8");
const manifest = JSON.parse(read("chronos/scripts/smoke/host-seams.json"));
const label = ({ modules, selector, owner }) => modules.join(", ") + " / " + selector + " / " + owner;
const [, , mode, base, head] = process.argv;
if (mode === "--upstream") {
  const changed = new Set(execFileSync("git", ["diff", "--name-only", base, head], { encoding: "utf8" }).trim().split("\n"));
  const blobs = new Map();
  const blob = (ref, path) => {
    const id = ref + ":" + path;
    if (!blobs.has(id)) {
      try { blobs.set(id, execFileSync("git", ["show", id], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })); }
      catch { blobs.set(id, ""); }
    }
    return blobs.get(id);
  };
  for (const row of manifest.filter(row => changed.has(row.owner))) {
    const lost = blob(base, row.owner).includes(row.marker) && !blob(head, row.owner).includes(row.marker);
    console.log((lost ? "REMOVED" : "Review") + " Olympus " + label(row));
    if (lost) process.exitCode = 1;
  }
} else {
  for (const row of manifest) {
    if (!NodeFS.existsSync(NodePath.join(root, row.owner)) || !read(row.owner).includes(row.marker)) {
      console.error("Missing Olympus host seam:", label(row), JSON.stringify(row.marker));
      process.exitCode = 1;
    }
  }
  const expected = JSON.parse(read("chronos/scripts/smoke/checks.json")).globals;
  for (const name of new Set([...expected, ...Object.keys(globals).filter(name => name.startsWith("__oly"))])) {
    if (!expected.includes(name) || !globals[name]) throw Error("Missing packaged global contract: " + name);
  }
  console.log(manifest.length, "host markers checked");
}

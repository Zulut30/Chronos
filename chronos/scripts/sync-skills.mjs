// Run from the checkout whose skill versions should be active for the user.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import * as NodeURL from "node:url";

const sourceDirectory = NodeURL.fileURLToPath(new URL("../skills/", import.meta.url));
const skillName = /^chronos-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const stat = (path) => NodeFS.lstatSync(path, { throwIfNoEntry: false });

function inspectTree(directory, prefix = "") {
  // Compare the complete package, including empty directories and executable scripts.
  if (!NodeFS.lstatSync(directory).isDirectory())
    throw new Error("Expected a directory: " + directory);
  const result = [];
  for (const name of NodeFS.readdirSync(directory).sort()) {
    const relative = prefix + name;
    const path = NodePath.join(directory, name);
    const entry = NodeFS.lstatSync(path);
    if (entry.isDirectory()) {
      result.push([relative + "/"], ...inspectTree(path, relative + "/"));
    } else if (entry.isFile()) {
      const hash = NodeCrypto.createHash("sha256").update(NodeFS.readFileSync(path)).digest("hex");
      result.push([relative, entry.mode & 0o111, hash]);
    } else {
      throw new Error("Expected a regular file or directory: " + path);
    }
  }
  return result;
}

function readManaged(path) {
  if (!stat(path)) return [];
  const names = JSON.parse(NodeFS.readFileSync(path, "utf8"));
  if (
    !Array.isArray(names) ||
    names.some((name) => typeof name !== "string" || !skillName.test(name))
  ) {
    throw new Error("Invalid Chronos skill registry: " + path);
  }
  return names;
}

export function syncSkills(source, profile) {
  const packages = new Map();
  for (const name of NodeFS.readdirSync(source).sort()) {
    if (!name.startsWith("chronos-")) continue;
    const directory = NodePath.join(source, name);
    if (!skillName.test(name) || !stat(NodePath.join(directory, "SKILL.md"))?.isFile()) {
      throw new Error("Invalid Chronos skill: " + directory);
    }
    packages.set(name, inspectTree(directory));
  }
  if (!packages.size) throw new Error("Empty Chronos skill source: " + source);

  const destination = NodePath.join(profile, "skills");
  const state = NodePath.join(profile, "chronos-skill-sync");
  NodeFS.mkdirSync(destination, { recursive: true });
  NodeFS.mkdirSync(state, { recursive: true });
  const registry = NodePath.join(state, "managed.json");
  const lock = NodePath.join(state, "sync.lock");
  // A second sync must not archive a package midway through another installation.
  NodeFS.writeFileSync(lock, String(process.pid), { flag: "wx" });
  let stage;
  const backup = NodePath.join(
    state,
    "backups",
    new Date().toISOString().replaceAll(":", "-") + "-" + NodeCrypto.randomUUID(),
  );
  const changes = { installed: [], replaced: [], removed: [], unchanged: [] };
  function archive(name, reason) {
    const category = NodePath.join(backup, reason);
    NodeFS.mkdirSync(category, { recursive: true });
    const snapshot = NodePath.join(category, name);
    NodeFS.renameSync(NodePath.join(destination, name), snapshot);
    return snapshot;
  }

  try {
    const previous = readManaged(registry);
    for (const [name, expected] of packages) {
      const target = NodePath.join(destination, name);
      const exists = stat(target);
      if (exists && NodeUtil.isDeepStrictEqual(expected, inspectTree(target))) {
        changes.unchanged.push(name);
        continue;
      }
      stage ??= NodeFS.mkdtempSync(NodePath.join(state, "stage-"));
      const prepared = NodePath.join(stage, name);
      NodeFS.cpSync(NodePath.join(source, name), prepared, { recursive: true });
      if (!NodeUtil.isDeepStrictEqual(expected, inspectTree(prepared))) {
        throw new Error("Source changed while copying: " + name);
      }
      const snapshot = exists && archive(name, "replaced");
      try {
        NodeFS.renameSync(prepared, target);
      } catch (error) {
        if (snapshot) NodeFS.renameSync(snapshot, target);
        throw error;
      }
      changes[exists ? "replaced" : "installed"].push(name);
    }
    for (const name of previous) {
      if (packages.has(name)) continue;
      const target = stat(NodePath.join(destination, name));
      if (target) {
        if (!target.isDirectory()) throw new Error("Unexpected installed entry: " + name);
        archive(name, "removed");
      }
      changes.removed.push(name);
    }
    const current = [...packages.keys()];
    if (!NodeUtil.isDeepStrictEqual(current, previous)) {
      stage ??= NodeFS.mkdtempSync(NodePath.join(state, "stage-"));
      const manifest = NodePath.join(stage, "managed.json");
      NodeFS.writeFileSync(manifest, JSON.stringify(current, null, 2) + "\n");
      NodeFS.renameSync(manifest, registry);
    }
    return { ...changes, backup: stat(backup) ? backup : null };
  } finally {
    try {
      if (stage) NodeFS.rmSync(stage, { recursive: true, force: true });
    } finally {
      NodeFS.unlinkSync(lock);
    }
  }
}

if (process.argv[1] && import.meta.url === NodeURL.pathToFileURL(process.argv[1]).href) {
  for (const agent of [".claude", ".codex", ".agents"]) {
    const result = syncSkills(sourceDirectory, NodePath.join(NodeOS.homedir(), agent));
    console.log(agent + ": " + JSON.stringify(result));
  }
}

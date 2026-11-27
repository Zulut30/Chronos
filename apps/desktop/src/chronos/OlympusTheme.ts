// @effect-diagnostics nodeBuiltinImport:off -- Publication needs atomic no-clobber links and exact file bytes.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

// Shipped Olympus theme exports (pre-Graphite and chronos.17 Graphite), LF or CRLF.
const originalHashes = new Set([
  "9497adb6f56f6d954562b37c5b1e556131aff1de49c092fe837e844f8c026c24",
  "b653fa22e576ae1511ac2a1a580f342c64f61b82aef47b2e384cd10cda127e56",
  "153e278abc5949a4b1bb36cda105a04c70eb8407afc4c4348a45053d9d205afd",
  "82fa80c6e327dee9a646c4bbace32f9d811d866deb7403e1a2fcf574ee7ee1e4",
]);
const originalSizes = new Set([377698, 377563, 379417, 379552]);
const maxBytes = 2 * 1024 * 1024;
const maxFiles = 32;

function linkIfMissing(source: string, destination: string) {
  try {
    NodeFS.linkSync(source, destination);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

function publishCopy(source: string, destination: string) {
  const stage = destination + "." + NodeCrypto.randomUUID();
  NodeFS.copyFileSync(source, stage, NodeFS.constants.COPYFILE_EXCL);
  try {
    return linkIfMissing(stage, destination);
  } finally {
    NodeFS.unlinkSync(stage);
  }
}

function isOriginal(file: string) {
  const info = NodeFS.lstatSync(file, { throwIfNoEntry: false });
  if (!info?.isFile() || !originalSizes.has(info.size)) return false;
  return originalHashes.has(NodeCrypto.createHash("sha256").update(NodeFS.readFileSync(file)).digest("hex"));
}

export function installOlympusTheme(stateDir: string, resource: string) {
  const themes = NodePath.join(stateDir, "themes");
  const current = NodePath.join(themes, "olympus.json");
  const updates = NodePath.join(stateDir, "theme-updates");
  const previous = NodePath.join(updates, "olympus.previous");
  const settings = NodePath.join(stateDir, "settings.json");
  const bytes = NodeFS.statSync(resource).size;
  NodeFS.mkdirSync(themes, { recursive: true });

  // Recover the file captured by an interrupted upgrade, including an editor save racing startup.
  if (NodeFS.lstatSync(previous, { throwIfNoEntry: false })?.isFile()) {
    if (linkIfMissing(previous, current) || isOriginal(previous)) NodeFS.unlinkSync(previous);
  }

  const installed = NodeFS.lstatSync(current, { throwIfNoEntry: false });
  if (installed?.isFile() && installed.size === bytes &&
      NodeFS.readFileSync(current).equals(NodeFS.readFileSync(resource))) return;
  const offer = () => {
    NodeFS.mkdirSync(updates, { recursive: true });
    const copy = NodePath.join(updates, "olympus-graphite.json");
    if (!NodeFS.lstatSync(copy, { throwIfNoEntry: false })) publishCopy(resource, copy);
  };
  if (installed && !isOriginal(current)) {
    offer();
    return;
  }

  // Count conservatively so publishing cannot evict an existing theme from the server catalog.
  let total = bytes;
  let count = 1;
  for (const entry of NodeFS.readdirSync(themes, { withFileTypes: true })) {
    if (entry.name === "olympus.json" || !entry.name.endsWith(".json")) continue;
    count++;
    if (entry.isFile()) total += NodeFS.statSync(NodePath.join(themes, entry.name)).size;
  }
  if (total > maxBytes || count > maxFiles) {
    offer();
    return;
  }

  if (installed) {
    NodeFS.mkdirSync(updates, { recursive: true });
    if (NodeFS.lstatSync(previous, { throwIfNoEntry: false })) return;
    NodeFS.renameSync(current, previous);
    // Inspect the file we actually moved. Restore a concurrent save without overwriting a new one.
    if (!isOriginal(previous)) {
      if (linkIfMissing(previous, current)) NodeFS.unlinkSync(previous);
      offer();
      return;
    }
  }
  try {
    if (!publishCopy(resource, current)) return;
    // Desktop starts before its backend. A previously initialized database identifies an upgrade,
    // even if the user never saved any server settings.
    if (!installed && !NodeFS.existsSync(NodePath.join(stateDir, "statev2.sqlite")) && !NodeFS.existsSync(settings)) {
      try {
        NodeFS.writeFileSync(settings, '{"defaultTheme":"olympus"}\n', { flag: "wx", mode: 0o600 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
  } finally {
    if (installed) {
      linkIfMissing(previous, current);
      NodeFS.unlinkSync(previous);
    }
  }
}

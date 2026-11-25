// @effect-diagnostics nodeBuiltinImport:off -- Publication needs atomic no-clobber links and exact file bytes.
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

// The original Olympus export, as shipped with CRLF or LF line endings.
const originalHashes = new Set([
  "9497adb6f56f6d954562b37c5b1e556131aff1de49c092fe837e844f8c026c24",
  "b653fa22e576ae1511ac2a1a580f342c64f61b82aef47b2e384cd10cda127e56",
]);
const maxBytes = 2 * 1024 * 1024;
const maxFiles = 32;

function linkIfMissing(source: string, destination: string) {
  try {
    fs.linkSync(source, destination);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

function publishCopy(source: string, destination: string) {
  const stage = destination + "." + randomUUID();
  fs.copyFileSync(source, stage, fs.constants.COPYFILE_EXCL);
  try {
    return linkIfMissing(stage, destination);
  } finally {
    fs.unlinkSync(stage);
  }
}

function isOriginal(file: string) {
  const info = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!info?.isFile() || (info.size !== 377698 && info.size !== 377563)) return false;
  return originalHashes.has(createHash("sha256").update(fs.readFileSync(file)).digest("hex"));
}

export function installOlympusTheme(stateDir: string, resource: string) {
  const themes = path.join(stateDir, "themes");
  const current = path.join(themes, "olympus.json");
  const updates = path.join(stateDir, "theme-updates");
  const previous = path.join(updates, "olympus.previous");
  const settings = path.join(stateDir, "settings.json");
  fs.mkdirSync(themes, { recursive: true });

  // Recover the file captured by an interrupted upgrade, including an editor save racing startup.
  if (fs.lstatSync(previous, { throwIfNoEntry: false })?.isFile()) {
    if (linkIfMissing(previous, current) || isOriginal(previous)) fs.unlinkSync(previous);
  }

  const installed = fs.lstatSync(current, { throwIfNoEntry: false });
  const bytes = fs.statSync(resource).size;
  if (installed?.isFile() && installed.size === bytes &&
      fs.readFileSync(current).equals(fs.readFileSync(resource))) return;
  const offer = () => {
    fs.mkdirSync(updates, { recursive: true });
    const copy = path.join(updates, "olympus-graphite.json");
    if (!fs.lstatSync(copy, { throwIfNoEntry: false })) publishCopy(resource, copy);
  };
  if (installed && !isOriginal(current)) {
    offer();
    return;
  }

  // Count conservatively so publishing cannot evict an existing theme from the server catalog.
  let total = bytes;
  let count = 1;
  for (const entry of fs.readdirSync(themes, { withFileTypes: true })) {
    if (entry.name === "olympus.json" || !entry.name.endsWith(".json")) continue;
    count++;
    if (entry.isFile()) total += fs.statSync(path.join(themes, entry.name)).size;
  }
  if (total > maxBytes || count > maxFiles) {
    offer();
    return;
  }

  if (installed) {
    fs.mkdirSync(updates, { recursive: true });
    if (fs.lstatSync(previous, { throwIfNoEntry: false })) return;
    fs.renameSync(current, previous);
    // Inspect the file we actually moved. Restore a concurrent save without overwriting a new one.
    if (!isOriginal(previous)) {
      if (linkIfMissing(previous, current)) fs.unlinkSync(previous);
      offer();
      return;
    }
  }
  try {
    if (!publishCopy(resource, current)) return;
    // Desktop starts before its backend. A previously initialized database identifies an upgrade,
    // even if the user never saved any server settings.
    if (!installed && !fs.existsSync(path.join(stateDir, "statev2.sqlite")) && !fs.existsSync(settings)) {
      try {
        fs.writeFileSync(settings, '{"defaultTheme":"olympus"}\n', { flag: "wx", mode: 0o600 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
  } finally {
    if (installed) {
      linkIfMissing(previous, current);
      fs.unlinkSync(previous);
    }
  }
}

// @effect-diagnostics nodeBuiltinImport:off -- This offline check runs before the desktop layers and only reads a staged copy.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeUtil from "node:util";
import * as Electron from "electron";
import * as Schema from "effect/Schema";
import { DEFAULT_MODEL_BY_PROVIDER, ProviderInstanceConfigMap } from "@t3tools/contracts";
import { ConnectionCatalogDocument } from "@t3tools/client-runtime/platform";

const decodeCatalog = Schema.decodeUnknownSync(ConnectionCatalogDocument);
const decodeInstances = Schema.decodeUnknownSync(ProviderInstanceConfigMap);

function readCatalog(folder: string) {
  const envelope = JSON.parse(
    NodeFS.readFileSync(NodePath.join(folder, "connection-catalog.json"), "utf8"),
  );
  const json = Electron.safeStorage.decryptString(Buffer.from(envelope.encryptedCatalog, "base64"));
  return decodeCatalog(JSON.parse(json));
}

// Never bring up a renderer, a server, a provider, Clerk or the SSH manager in this process.
export async function auditSwitchProfile(platform: NodeJS.Platform, directory: string | undefined) {
  const root = NodeFS.realpathSync.native(directory || "");
  if (
    platform !== "win32" ||
    NodePath.dirname(root).toLowerCase() !==
      NodeFS.realpathSync.native(NodeOS.tmpdir()).toLowerCase() ||
    !/^chronos-switch-audit-[a-z0-9_-]+$/iu.test(NodePath.basename(root))
  )
    throw new Error("Invalid switch audit directory");
  Electron.app.setPath("userData", NodePath.join(root, "profile"));
  Electron.app.disableHardwareAcceleration();
  await Electron.app.whenReady();
  const before = NodePath.join(root, "original");
  const after = NodePath.join(root, "candidate");
  const settings = (dir: string) =>
    JSON.parse(
      NodeFS.readFileSync(NodePath.join(dir, "settings.json"), "utf8").replace(/^\uFEFF/u, ""),
    );
  const oldSettings = settings(before);
  const newSettings = settings(after);
  const instances = decodeInstances(newSettings.providerInstances ?? {});
  // The registry driver adds user-selected agents only. The other built-in drivers seed their default instance.
  const builtIns = Object.keys(DEFAULT_MODEL_BY_PROVIDER).filter((kind) => kind !== "acpRegistry");
  if (!NodeUtil.isDeepStrictEqual(oldSettings, newSettings))
    throw new Error("Provider settings mismatch");
  if (!Electron.safeStorage.isEncryptionAvailable()) throw new Error("Profile key unavailable");
  const oldCatalog = readCatalog(before);
  const newCatalog = readCatalog(after);
  if (!NodeUtil.isDeepStrictEqual(oldCatalog, newCatalog)) throw new Error("Catalog mismatch");
  const ssh = newCatalog.profiles.filter((p) => p._tag === "SshConnectionProfile");
  const targets = newCatalog.targets;
  if (
    targets.some(
      (t) =>
        t._tag === "SshConnectionTarget" && !ssh.some((p) => p.connectionId === t.connectionId),
    )
  ) {
    throw new Error("SSH target without a saved profile");
  }
  NodeFS.writeFileSync(
    NodePath.join(root, "result.json"),
    JSON.stringify({
      configuredInstances: Object.keys(instances).length,
      instancesWithDefaults: new Set([...builtIns, ...Object.keys(instances)]).size,
      settingsMatch: true,
      sshProfiles: ssh.length,
      sshTargets: targets.filter((t) => t._tag === "SshConnectionTarget").length,
      relayTargets: targets.filter((t) => t._tag === "RelayConnectionTarget").length,
      bearerTargets: targets.filter((t) => t._tag === "BearerConnectionTarget").length,
      savedAddressesMatch: true,
      protectedEntries: newCatalog.credentials.length + newCatalog.remoteDpopTokens.length,
      decryptable: true,
    }),
    { flag: "wx" },
  );
}

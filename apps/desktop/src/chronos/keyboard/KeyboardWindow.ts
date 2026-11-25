// @effect-diagnostics nodeBuiltinImport:off -- The Electron window owns the optional native input session.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { dialog, shell, type BrowserWindow } from "electron";
import { isChronosVersion } from "@t3tools/shared/cliRelease";

interface Host {
  platform: NodeJS.Platform;
  appVersion: string;
  isPackaged: boolean;
  baseDir: string;
  rootDir: string;
  resourcesPath: string;
}
type Request = (op: string, payload?: unknown) => Promise<unknown>;

export function installKeyboardWindow(
  win: BrowserWindow,
  host: Host,
  origin: string,
) {
  if (host.platform !== "win32" || !isChronosVersion(host.appVersion)) return;
  const trusted = () =>
    !win.isDestroyed() && win.webContents.getURL().startsWith(origin);
  let request: Request | undefined;
  function load(): Request {
    if (request) return request;
    const dir = host.isPackaged
      ? path.join(host.resourcesPath, "chronos-keyboard")
      : path.join(host.rootDir, "chronos", "keyboard");
    const requireLocal = createRequire(path.join(dir, "desktop.cjs"));
    const modelPath = host.isPackaged
      ? "./profile.cjs"
      : "../skills/chronos-keyboard/scripts/profile.cjs";
    const binary = host.isPackaged
      ? path.join(dir, "chronos-keyboard.exe")
      : path.join(
          host.rootDir,
          "native",
          "keyboard-input",
          "target",
          "release",
          "chronos-keyboard.exe",
        );
    const adapter = requireLocal("./desktop.cjs") as {
      attach(opts: object): Request;
    };
    request = adapter.attach({
      win,
      root: host.baseDir,
      model: requireLocal(modelPath),
      binary,
      dialog,
      shell,
      trusted,
    });
    return request;
  }
  win.webContents.ipc.handle(
    "chronos:keyboard",
    (event, op: string, payload?: unknown) => {
      if (event.senderFrame !== win.webContents.mainFrame || !trusted())
        throw new Error("Недоступно в этом окне.");
      return load()(op, payload);
    },
  );
  // Fresh profiles have no settings file, child, timers or hot-plug subscription.
  if (
    existsSync(path.join(host.baseDir, "userdata", "keyboard", "settings.json"))
  ) {
    try {
      load();
    } catch {
      /* Opening the panel surfaces a damaged profile. */
    }
  }
}

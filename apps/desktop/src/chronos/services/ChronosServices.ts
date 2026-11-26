import * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { isChronosVersion } from "@t3tools/shared/cliRelease";

import type { DesktopEnvironment } from "../../app/DesktopEnvironment.ts";
import { createServiceHost, probe, services, supervise } from "./Sidecars.ts";
import { rehearsalOffset } from "./ServiceOrigins.ts";
import { isolateRehearsalRequests } from "./SwitchRehearsal.ts";

export const startChronosServices = Effect.fn("ChronosServices.start")(function* (
  environment: DesktopEnvironment["Service"],
) {
  if (!environment.isPackaged || !isChronosVersion(environment.appVersion)) return;
  const options = {
    baseDir: environment.baseDir,
    platform: environment.platform,
    resources: environment.path.join(environment.resourcesPath, "chronos-services"),
    executable: yield* HostProcess.ExecutablePath,
    showArtifact: (id:string,confirmDelete:boolean) => {
      const window = Electron.BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().startsWith("t3code://app/"));
      if (!window || window.isDestroyed()) return false;
      if (window.isMinimized()) window.restore();
      window.show();
      window.webContents.send("chronos:show-artifact",id,confirmDelete);
      return true;
    },
    env: yield* HostProcess.Environment,
  };
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const host = createServiceHost(options);
      const rehearsal = options.env.CHRONOS_SWITCH_REHEARSAL === "1";
      if (rehearsal) isolateRehearsalRequests(options.env.T3CODE_PORT);
      const targets = rehearsal ? services.map(s => ({ ...s, port: s.port + rehearsalOffset })) : services;
      const stops = targets.map((service) => supervise(service, options, { probe, launch: host.launch }));
      const stopAll = () => { for (const stop of stops) stop(); host.stop(); };
      // Electron's updater can exit before the desktop scope closes.
      process.once("exit", stopAll);
      return () => { process.off("exit", stopAll); stopAll(); };
    }),
    (stop) => Effect.sync(stop),
  );
});

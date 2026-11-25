import * as Effect from "effect/Effect";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { isChronosVersion } from "@t3tools/shared/cliRelease";

import type { DesktopEnvironment } from "../../app/DesktopEnvironment.ts";
import { createServiceHost, probe, services, supervise } from "./Sidecars.ts";

export const startChronosServices = Effect.fn("ChronosServices.start")(function* (
  environment: DesktopEnvironment["Service"],
) {
  if (!environment.isPackaged || !isChronosVersion(environment.appVersion)) return;
  const options = {
    baseDir: environment.baseDir,
    resources: environment.path.join(environment.resourcesPath, "chronos-services"),
    executable: yield* HostProcess.ExecutablePath,
    env: yield* HostProcess.Environment,
  };
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const host = createServiceHost(options);
      const stops = services.map((service) => supervise(service, options, { probe, launch: host.launch }));
      const stopAll = () => { for (const stop of stops) stop(); host.stop(); };
      // Electron's updater can exit before the desktop scope closes.
      process.once("exit", stopAll);
      return () => { process.off("exit", stopAll); stopAll(); };
    }),
    (stop) => Effect.sync(stop),
  );
});

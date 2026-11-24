import * as Effect from "effect/Effect";
import { join } from "node:path";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { isChronosVersion } from "@t3tools/shared/cliRelease";

import type { DesktopEnvironment } from "../../app/DesktopEnvironment.ts";
import { services, supervise } from "./Sidecars.ts";

export const startChronosServices = Effect.fn("ChronosServices.start")(function* (
  environment: DesktopEnvironment["Service"],
) {
  if (!environment.isPackaged || !isChronosVersion(environment.appVersion)) return;
  const options = {
    baseDir: environment.baseDir,
    resources: join(environment.resourcesPath, "chronos-services"),
    executable: yield* HostProcess.ExecutablePath,
    env: yield* HostProcess.Environment,
  };
  yield* Effect.acquireRelease(
    Effect.sync(() => services.map((service) => supervise(service, options))),
    (stops) => Effect.sync(() => { for (const stop of stops) stop(); }),
  );
});

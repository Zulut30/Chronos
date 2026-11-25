import { CHRONOS_SCHEME } from "@t3tools/shared/cliRelease";

import * as ElectronProtocol from "../electron/ElectronProtocol.ts";

/**
 * Renderers keep only the last registerSchemesAsPrivileged list, and Clerk's chronos:// call
 * drops t3code://app fetch support. Call synchronously right after the Clerk bridge, before ready.
 */
export function restoreDesktopSchemePrivileges(): void {
  ElectronProtocol.registerDesktopSchemePrivilegesSync([
    { scheme: "chronos-artifact", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
    {
      scheme: CHRONOS_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

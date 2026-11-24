import { CHRONOS_SCHEME } from "@t3tools/shared/cliRelease";

import * as ElectronProtocol from "../electron/ElectronProtocol.ts";

/**
 * Clerk's bridge registers privileges for its callback scheme (chronos://) with its own
 * registerSchemesAsPrivileged call, and Chromium keeps only the last call's list for renderers.
 * Without this the app origin t3code://app loses fetch support (terminal wasm, assets).
 * Register the app schemes again together with chronos:// using Clerk's privileges.
 * Must run synchronously before Electron emits ready, right after the Clerk bridge is created.
 */
export function restoreDesktopSchemePrivileges(): void {
  ElectronProtocol.registerDesktopSchemePrivilegesSync([
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

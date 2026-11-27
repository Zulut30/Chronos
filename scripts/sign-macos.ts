import { sign as signApplication, type SignOptions } from "@electron/osx-sign";
import { CHRONOS_APP_ID } from "@t3tools/shared/cliRelease";

export default async function sign(options: SignOptions): Promise<void> {
  // chronos: Keychain and Squirrel both use the running bundle's designated requirement.
  if (options.app.endsWith("/Chronos.app")) {
    if (!options.identity || !/^[0-9a-f]{40}$/i.test(options.identity)) {
      throw new Error("Chronos signing requires a certificate fingerprint.");
    }
    const requirements = `=designated => identifier "${CHRONOS_APP_ID}" and certificate leaf = H"${options.identity}"`;
    await signApplication({
      ...options,
      batchCodesignCalls: true,
      optionsForFile: (file, context) => ({
        ...options.optionsForFile?.(file, context),
        ...(file === options.app ? { requirements } : {}),
      }),
    });
    return;
  }
  await signApplication({ ...options, batchCodesignCalls: true });
}

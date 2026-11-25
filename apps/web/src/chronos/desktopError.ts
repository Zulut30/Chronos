/** Electron prefixes rejected IPC calls with the channel name in English. */
export function desktopError(error: unknown, fallback: string) {
  const message = (error instanceof Error ? error.message : String(error))
    .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
  return /^[А-Яа-яЁё]/u.test(message) ? message : fallback;
}

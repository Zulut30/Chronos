/** Electron prefixes rejected IPC calls with the channel name in English. */
export function desktopError(error: unknown, fallback: string) {
  const message = (error instanceof Error ? error.message : String(error))
    .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
  if (!/^[А-Яа-яЁё]/u.test(message)) return fallback;
  const translate = globalThis.window?.__chronosEnglishText;
  if (!translate) return message;
  const translated = translate(message);
  return translated === message ? fallback : translated;
}

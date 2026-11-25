// @effect-diagnostics globalTimers:off -- A standby child has no Effect scope. Taking it cancels expiry.
export function makeStandbyProcess<T extends { readonly alive: boolean; readonly close: () => void }>(
  start: () => T,
  idleMs: number | undefined,
) {
  let process: T | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function take() {
    clearTimeout(timer);
    timer = undefined;
    const child = process;
    process = undefined;
    return child?.alive ? child : start();
  }
  function cool() {
    clearTimeout(timer);
    timer = undefined;
    process?.close();
    process = undefined;
  }
  function warm() {
    if (process?.alive) return;
    clearTimeout(timer);
    process = start();
    if (idleMs !== undefined) timer = setTimeout(cool, idleMs);
  }
  return { take, cool, warm };
}

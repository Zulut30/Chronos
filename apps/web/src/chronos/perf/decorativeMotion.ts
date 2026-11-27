const idleMs = 15_000;
const activeClass = "chronos-motion-active";

export function trackDecorativeMotion(win: Window, doc: Document) {
  const reduced = win.matchMedia("(prefers-reduced-motion: reduce)");
  const listeners = new AbortController();
  const options = { signal: listeners.signal, capture: true, passive: true };
  let timer: number | undefined;
  let deadline = 0;
  let eligible = false;

  function pause() {
    win.clearTimeout(timer);
    timer = undefined;
    doc.documentElement.classList.remove(activeClass);
  }

  function expire() {
    const remaining = deadline - performance.now();
    if (remaining > 0) timer = win.setTimeout(expire, remaining);
    else pause();
  }

  function activity() {
    if (!eligible) return;
    deadline = performance.now() + idleMs;
    // Pointer moves update a deadline without removing classes or reallocating timers.
    if (timer !== undefined) return;
    doc.documentElement.classList.add(activeClass);
    timer = win.setTimeout(expire, idleMs);
  }

  function sync() {
    eligible = !reduced.matches && !doc.hidden && doc.hasFocus();
    if (eligible) activity();
    else pause();
  }

  win.addEventListener("focus", sync, { signal: listeners.signal });
  win.addEventListener("blur", () => {
    eligible = false;
    pause();
  }, { signal: listeners.signal });
  doc.addEventListener("visibilitychange", sync, options);
  reduced.addEventListener("change", sync, options);
  for (const event of ["pointermove", "pointerdown", "keydown", "wheel", "input", "touchmove"]) {
    doc.addEventListener(event, activity, options);
  }
  sync();
  return () => {
    listeners.abort();
    pause();
  };
}

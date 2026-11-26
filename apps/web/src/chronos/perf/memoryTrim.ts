// chronos: central registry for releasing transient renderer caches on minimize or long background hide.

export const CHRONOS_MEMORY_TRIM_EVENT = "chronos:memory-trim";
const HIDDEN_TAB_MEMORY_TRIM_DELAY_MS = 120_000;

interface VisibilityDocumentTarget {
  readonly visibilityState: string;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
}

const trimmers = new Set<() => void>();
let defaultTargetAttached = false;

export function runMemoryTrim(): void {
  for (const trim of [...trimmers]) {
    try {
      trim();
    } catch {
      // One cache trimmer failing must not prevent other caches from releasing memory.
    }
  }
}

export function attachMemoryTrimTarget(
  targetWindow: Pick<EventTarget, "addEventListener" | "removeEventListener">,
  targetDocument?: VisibilityDocumentTarget | undefined,
  hiddenDelayMs = HIDDEN_TAB_MEMORY_TRIM_DELAY_MS,
): () => void {
  let hiddenTimer: ReturnType<typeof setTimeout> | undefined;

  const cancelHiddenTimer = () => {
    if (hiddenTimer !== undefined) {
      clearTimeout(hiddenTimer);
      hiddenTimer = undefined;
    }
  };

  const onTrimEvent = () => {
    cancelHiddenTimer();
    runMemoryTrim();
  };

  const onVisibilityChange = () => {
    if (!targetDocument) return;
    if (targetDocument.visibilityState === "hidden") {
      if (hiddenTimer !== undefined) return;
      hiddenTimer = setTimeout(() => {
        hiddenTimer = undefined;
        if (targetDocument.visibilityState === "hidden") {
          runMemoryTrim();
        }
      }, hiddenDelayMs);
    } else {
      cancelHiddenTimer();
    }
  };

  targetWindow.addEventListener(CHRONOS_MEMORY_TRIM_EVENT, onTrimEvent);
  targetDocument?.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    cancelHiddenTimer();
    targetWindow.removeEventListener(CHRONOS_MEMORY_TRIM_EVENT, onTrimEvent);
    targetDocument?.removeEventListener("visibilitychange", onVisibilityChange);
  };
}

function ensureDefaultTargetAttached(): void {
  if (
    defaultTargetAttached ||
    typeof window === "undefined" ||
    typeof window.addEventListener !== "function"
  ) {
    return;
  }
  defaultTargetAttached = true;
  attachMemoryTrimTarget(
    window,
    typeof document !== "undefined" && typeof document.addEventListener === "function"
      ? document
      : undefined,
  );
}

export function registerMemoryTrimmer(trim: () => void): () => void {
  ensureDefaultTargetAttached();
  trimmers.add(trim);
  return () => {
    trimmers.delete(trim);
  };
}

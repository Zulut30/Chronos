const overlaySelector = "[data-oly-tasks-overlay]";
const controls = "button, input, select, textarea, a[href], [tabindex]";

function containFocus(board: HTMLElement) {
  // The project list and cards are replaced on refresh. The dialog survives those renders.
  board.tabIndex = -1;
  if (!board.contains(document.activeElement)) board.focus({ preventScroll: true });

  const keepTabInside = (event: KeyboardEvent) => {
    if (event.key !== "Tab" || event.defaultPrevented || !board.isConnected) return;
    const scope = board.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]') ?? board;
    const stops = Array.from(scope.querySelectorAll<HTMLElement>(controls)).filter(
      (el) => el.tabIndex >= 0 && !el.matches(":disabled") && el.checkVisibility(),
    );
    const first = stops[0];
    const last = stops.at(-1);
    const current = document.activeElement;
    const edge = event.shiftKey ? first : last;
    if (!first || !scope.contains(current) || current === scope || current === edge) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    }
  };
  document.addEventListener("keydown", keepTabInside, true);
  return () => document.removeEventListener("keydown", keepTabInside, true);
}

export function startTaskBoardFocus() {
  let board: HTMLElement | null = null;
  let release: (() => void) | undefined;
  // Only direct body children change this module's modal state, including a retry after load failure.
  const observer = new MutationObserver((records) => {
    if (board && !board.isConnected) {
      release?.();
      release = undefined;
      board = null;
    }
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement) || !node.isConnected || !node.matches(overlaySelector)) {
          continue;
        }
        board = node.querySelector<HTMLElement>('[role="dialog"]');
        if (board) release = containFocus(board);
      }
    }
  });
  observer.observe(document.body, { childList: true });
}

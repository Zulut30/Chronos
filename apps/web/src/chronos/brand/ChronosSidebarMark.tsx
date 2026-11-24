import { cn } from "~/lib/utils";

import chronosMarkUrl from "./chronos-mark-64.png";

/** Chronos mark and name in the sidebar header, in place of the T3 wordmark. */
export function ChronosSidebarMark({ onBackdrop }: { onBackdrop: boolean }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-sm font-medium tracking-tight">
      <img
        alt=""
        aria-hidden
        className="h-3.5 w-auto shrink-0 select-none"
        draggable={false}
        src={chronosMarkUrl}
      />
      <span
        className={cn(
          "truncate [text-box:trim-both_cap_alphabetic] supports-[text-box:trim-both_cap_alphabetic]:py-1",
          onBackdrop ? "text-white" : "text-foreground",
        )}
      >
        Chronos
      </span>
    </span>
  );
}

// chronos: sidebar brand mark (logo + name). The logo is a mask filled with the text
// color, so it follows every theme; at night it is Olympus gold. See chronos/README.md.
import { cn } from "../lib/utils";
import chronosMark from "./chronos-mark.png";

export function ChronosBrandMark({ onBackdrop }: { onBackdrop: boolean }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-sm font-medium tracking-tight">
      <span
        aria-hidden
        className={cn("size-5 shrink-0 bg-current", !onBackdrop && "dark:text-[#E3BF5C]")}
        style={{
          maskImage: `url(${chronosMark})`,
          maskSize: "contain",
          maskRepeat: "no-repeat",
          maskPosition: "center",
        }}
      />
      <span className={cn("truncate", onBackdrop ? "text-white" : "text-foreground")}>Chronos</span>
    </span>
  );
}

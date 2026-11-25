import { useState, type ReactNode } from "react";
import { cn } from "~/lib/utils";

/** The accessible row and drag target stay mounted while expensive card controls are offscreen. */
export function SidebarCardContents({
  renderContents, compact, title, children,
}: {
  renderContents: boolean;
  compact: boolean;
  title: string;
  children: ReactNode;
}) {
  const [containsFocus, setContainsFocus] = useState(false);
  const visible = renderContents || containsFocus;
  return (
    <div
      className={cn(
        "relative z-10 h-[4.875rem] px-(--sidebar-row-content-inset) py-(--sidebar-content-inset)",
        compact && (visible ? "h-auto" : "h-[3.75rem]"),
      )}
      onFocusCapture={() => setContainsFocus(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setContainsFocus(false);
      }}
    >
      {visible ? children : <span data-sidebar-card-placeholder="" className="block truncate">{title}</span>}
    </div>
  );
}

import { memo, useRef } from "react";
// chronos: full-message copies include sanitized, standalone rich HTML.
import { chronosMessageClipboard } from "../../chronos/richText/clipboard";
import { CheckIcon, CopyIcon, type LucideIcon } from "lucide-react";
import { Button } from "../ui/button";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import {
  ANCHORED_COPY_TOAST_TIMEOUT_MS,
  showAnchoredCopyErrorToast,
} from "../ui/anchoredCopyToast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export const MessageCopyButton = memo(function MessageCopyButton({
  text,
  label = "Copy message",
  icon: Icon = CopyIcon,
  extraFlavors,
  size = "xs",
  variant = "outline",
  className,
}: {
  text: string;
  label?: string;
  icon?: LucideIcon;
  extraFlavors?: Readonly<Record<string, string>>;
  size?: "xs" | "icon-xs";
  variant?: "outline" | "ghost";
  className?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const rich = chronosMessageClipboard(text);
  const { copyToClipboard, isCopied } = useCopyToClipboard<void>({
    onError: (error: Error) => showAnchoredCopyErrorToast(ref, error),
    timeout: ANCHORED_COPY_TOAST_TIMEOUT_MS,
    ...(extraFlavors || rich
      ? { extraFlavors: { ...(rich ? { "text/html": rich.html } : {}), ...extraFlavors } }
      : {}),
  });

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            disabled={isCopied}
            onClick={() => copyToClipboard(rich?.text ?? text)}
            ref={ref}
            type="button"
            size={size}
            variant={variant === "ghost" ? "ghost-muted" : variant}
            className={className}
          />
        }
      >
        {isCopied ? <CheckIcon className="size-3 text-primary" /> : <Icon className="size-3" />}
      </TooltipTrigger>
      <TooltipPopup>
        <p>{label}</p>
      </TooltipPopup>
    </Tooltip>
  );
});

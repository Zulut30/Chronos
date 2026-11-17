import type { ProviderInteractionMode } from "@t3tools/contracts";
import {
  useComposerDraftStore,
  useComposerThreadDraft,
  resolveLiveComposerDraftTarget,
  type ComposerThreadTarget,
} from "../../composerDraftStore";
import { readThreadShell, useThreadShell } from "../../state/entities";
import { Button } from "../../components/ui/button";

export function readChronosInteractionMode(target: ComposerThreadTarget): ProviderInteractionMode {
  const live = resolveLiveComposerDraftTarget(target) ?? target;
  const store = useComposerDraftStore.getState();
  const override = store.getComposerDraft(live)?.interactionMode;
  const reported =
    typeof live === "string"
      ? store.getDraftThread(live)?.interactionMode
      : readThreadShell(live)?.interactionMode;
  return override ?? reported ?? "default";
}

export function ChronosPlanControl({ target }: { target: ComposerThreadTarget }) {
  const draft = useComposerThreadDraft(target);
  const shell = useThreadShell(typeof target === "string" ? null : target);
  const localThread = useComposerDraftStore((state) =>
    typeof target === "string" ? state.getDraftThread(target) : null,
  );
  const mode =
    draft.interactionMode ?? shell?.interactionMode ?? localThread?.interactionMode ?? "default";
  return (
    <Button
      variant="ghost-muted"
      size="xs"
      data-pressed={mode === "plan" ? true : undefined}
      type="button"
      aria-label="Plan"
      aria-pressed={mode === "plan"}
      onClick={() =>
        useComposerDraftStore
          .getState()
          .setInteractionMode(
            target,
            readChronosInteractionMode(target) === "plan" ? "default" : "plan",
          )
      }
    >
      {mode === "plan" ? "Plan" : "Default"}
    </Button>
  );
}

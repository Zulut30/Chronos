import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import type { KeyboardAction, ScopedProjectRef } from "@t3tools/contracts";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/shell";
import { useComposerHandleContext } from "../../composerHandleContext";
import { toastManager } from "../../components/ui/toast";
import { isAppModalPage } from "../../components/sidebar/mainAppLocation";
import { isCommandPaletteOpen } from "../../commandPaletteBus";
import { useStableCallback } from "../../hooks/useStableCallback";
import type { NewThreadHandler } from "../../hooks/useHandleNewThread";
import { readThreadShells } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { togglePadDictation } from "../../speech/useDictationShortcut";

function visible<T extends HTMLElement>(selector: string): T[] {
  return Array.from(document.querySelectorAll<T>(selector)).filter((el) => {
    if (el.closest("[data-side-chat-pane],[inert]")) return false;
    const r = el.getBoundingClientRect();
    return (
      r.width > 0 &&
      r.height > 0 &&
      r.bottom > 0 &&
      r.right > 0 &&
      r.top < innerHeight &&
      r.left < innerWidth
    );
  });
}
export function usePadActions(
  project: () => ScopedProjectRef | null,
  open: NewThreadHandler,
  navigate: (dir: "next" | "previous") => void,
) {
  const router = useRouter();
  const composer = useComposerHandleContext();
  const interrupt = useOrchestrationCommand(threadEnvironment.interruptTurn, {
    reportFailure: false,
  });
  const handle = useStableCallback(async (a: KeyboardAction) => {
    if (
      !document.hasFocus() ||
      isCommandPaletteOpen() ||
      isAppModalPage(router.state.location.pathname)
    )
      return;
    if (a.id === "stop") {
      const targets = readThreadShells().filter((t) =>
        threadRuntimeIsActive(t.runtime),
      );
      const results = await Promise.all(
        targets.map((t) =>
          interrupt({
            environmentId: t.environmentId,
            input: { threadId: t.id },
          }),
        ),
      );
      const errors = results.filter((r) => r._tag === "Failure").length;
      toastManager.add({
        type: errors ? "error" : "info",
        title: "Остановка агентов",
        description:
          "Прервано: " +
          (targets.length - errors) +
          ". Ошибок: " +
          errors +
          ".",
      });
      return;
    }
    if (visible('[aria-modal="true"],[role="alertdialog"]').length) return;
    switch (a.id) {
      case "draft": {
        const targetProject = project();
        if (!targetProject) throw new Error("Выберите проект для нового треда.");
        if (a.arg) {
          const { openModelDraft } = await import("./openModelDraft");
          await openModelDraft(targetProject, open, a.arg);
        } else {
          await open(targetProject);
        }
        break;
      }
      case "next":
      case "previous":
        navigate(a.id);
        break;
      case "model":
        composer?.current?.toggleModelPicker();
        break;
      case "mode":
        visible<HTMLButtonElement>("button.oly-plan")[0]?.click();
        break;
      case "voice":
        togglePadDictation();
        break;
      case "tasks":
        if (!document.querySelector("[data-oly-tasks-overlay]"))
          document
            .querySelector<HTMLButtonElement>("[data-oly-tasks]")
            ?.click();
        break;
      case "scroll-up":
      case "scroll-down": {
        const viewport = visible<HTMLElement>(".messages-timeline-scroll")[0];
        viewport?.scrollBy({
          top: a.id === "scroll-up" ? -96 : 96,
          behavior: "instant",
        });
        break;
      }
      case "approve":
      case "decline": {
        const decision = a.id === "approve" ? "accept" : "decline";
        const buttons = visible<HTMLButtonElement>(
          '[data-pad-decision="' + decision + '"]:not(:disabled)',
        );
        // The same request may appear both in the composer and timeline.
        if (new Set(buttons.map((b) => b.dataset.padRequest)).size === 1)
          buttons[0]?.click();
        break;
      }
    }
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- desktop input is scoped to the mounted main sidebar
  useEffect(
    () =>
      window.desktopBridge?.keyboard?.subscribe((e) => {
        if (e.type === "action")
          void handle(e.data).catch((err) =>
            toastManager.add({
              type: "error",
              title: "Клавиатуры",
              description: String(err),
            }),
          );
        if (e.type === "error")
          toastManager.add({
            type: "error",
            title: "Клавиатуры",
            description: e.data,
          });
      }),
    [handle],
  );
}

import type { ProviderInteractionMode } from "@t3tools/contracts";
import type { ComponentProps, ComponentType } from "react";
import type { ComposerPromptSegment } from "../../composer-editor-mentions";
import type { RightPanelSurfaceContent } from "../../components/chat/RightPanelSurfaceContent";
import type { RightPanelSurface } from "../../rightPanelStore";

declare global {
  var __olyPlanMode: (
    fallback: ProviderInteractionMode,
    threadId: string,
  ) => ProviderInteractionMode;
  var __olyWrapModeText: ((text: string, threadId: string) => string) | undefined;
  var __olyReferences:
    | {
        lex(text: string, base: (text: string) => ComposerPromptSegment[]): ComposerPromptSegment[];
      }
    | undefined;
  var __olyLangIcons:
    | {
        apply(
          sets: { standard: string; complete: string },
          config: { spriteSheet: string; byFileExtension: Record<string, string> },
        ): void;
      }
    | undefined;
  var __olyPanelHost:
    | ComponentType<
        ComponentProps<typeof RightPanelSurfaceContent> & {
          __hj: typeof RightPanelSurfaceContent;
          __surfaces: readonly RightPanelSurface[];
        }
      >
    | undefined;
}

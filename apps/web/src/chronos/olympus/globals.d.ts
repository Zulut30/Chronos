import type { ProviderInteractionMode } from "@t3tools/contracts";
import type { ComposerPromptSegment } from "../../composer-editor-mentions";

import type { OlympusPanelHost } from "./PanelHost";

declare global {
  var __olyIntegrations: { close(): void } | undefined;
  var __olyPromptsSettings: { open(): void } | undefined;
  var __olyMcpManager: { close(): void } | undefined;
  var __olyPlanMode: (
    fallback: ProviderInteractionMode,
    threadId: string,
  ) => ProviderInteractionMode;
  var __olyWrapModeText: ((text: string, threadId: string) => string) | undefined;
  var __olyThreadDetails: { shortLabel(label: string): string } | undefined;
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
  var __olyPanels: { state: { P: { follow: boolean } }; toggleFollow(): void } | undefined;
  var __olyPanelHost: OlympusPanelHost | undefined;
}

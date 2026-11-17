import { PuzzleIcon } from "lucide-react";
import type { CommandPaletteActionItem } from "../../components/CommandPalette.logic";
import { WORKSPACE_PANELS, useChronosWorkspace, type WorkspacePanel } from "./state";
import { localServicesAvailable } from "./services";
export function chronosCommandItems(): CommandPaletteActionItem[] {
  if (!localServicesAvailable()) return [];
  return Object.entries(WORKSPACE_PANELS).map(([id, label]) => ({
    kind: "action",
    value: `chronos:${id}`,
    title: `Chronos: ${label}`,
    searchTerms: ["chronos", id, label],
    icon: <PuzzleIcon />,
    run: async () => {
      useChronosWorkspace.getState().open(id as WorkspacePanel);
    },
  }));
}

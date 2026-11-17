import { create } from "zustand";

export const WORKSPACE_PANELS = {
  tasks: "Задачи",
  skills: "Скиллы",
  studio: "Студия",
  files: "Загрузки",
  machines: "Машины",
  openrouter: "OpenRouter",
  integrations: "API-ключи",
  mcp: "Серверы MCP",
  speed: "Скорость",
} as const;
export type WorkspacePanel = keyof typeof WORKSPACE_PANELS;
export const CHRONOS_SETTINGS_PATHS = {
  mcp: "/settings/mcp",
  skills: "/settings/skills",
  integrations: "/settings/chronos-keys",
} as const;
type SettingsPanel = keyof typeof CHRONOS_SETTINGS_PATHS;
export function chronosSettingsLabel(path: string): string | undefined {
  const panel = (Object.keys(CHRONOS_SETTINGS_PATHS) as SettingsPanel[]).find(
    (key) => CHRONOS_SETTINGS_PATHS[key] === path,
  );
  return panel ? WORKSPACE_PANELS[panel] : undefined;
}
let navigateSettings: ((panel: SettingsPanel) => void) | null = null;
export function registerChronosSettingsNavigation(navigate: (panel: SettingsPanel) => void) {
  navigateSettings = navigate;
  return () => {
    navigateSettings = null;
  };
}
export const useChronosWorkspace = create<{
  panel: WorkspacePanel | null;
  taskId: string | null;
  error: string;
  open: (panel: WorkspacePanel, options?: { taskId?: string }) => void;
  close: () => void;
}>((set) => ({
  panel: null,
  taskId: null,
  error: "",
  open: (panel, options) => {
    if (panel in CHRONOS_SETTINGS_PATHS) {
      set({ panel: null });
      navigateSettings?.(panel as SettingsPanel);
      return;
    }
    set({ panel, taskId: options?.taskId ?? null });
  },
  close: () => set({ panel: null }),
}));

export interface ComposerDelivery {
  text: string;
  files?: File[];
  target?: string;
  previewUrl?: string;
}
const composers = new Map<string, (delivery: ComposerDelivery) => Promise<void>>();
let activeComposer: string | null = null;
export function registerChronosComposer(
  id: string,
  receive: (delivery: ComposerDelivery) => Promise<void>,
): () => void {
  composers.set(id, receive);
  activeComposer = id;
  return () => {
    composers.delete(id);
    if (activeComposer === id) activeComposer = null;
  };
}
export async function deliverToComposer(delivery: ComposerDelivery): Promise<void> {
  const receive = composers.get(delivery.target ?? activeComposer ?? "");
  if (!receive) throw new Error("Откройте тред, чтобы добавить контекст в сообщение.");
  await receive(delivery);
}

export function readStored<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? "null") as T) ?? fallback;
  } catch {
    return fallback;
  }
}
export function saveStored(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}
export function readStoredText(key: string, fallback: string): string {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw.startsWith('"') ? JSON.parse(raw) : raw;
  } catch {
    return fallback;
  }
}

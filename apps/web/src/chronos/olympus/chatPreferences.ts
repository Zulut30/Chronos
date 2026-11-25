import { featureKey, type FeatureId } from "./featureFlags.ts";

export const preferenceKeys = {
  downloads: "oly-files-mode",
  notifications: "oly-notifications-mode",
  follow: "oly-panels-v1",
  taskMode: "oly-tasks-launch-mode",
  taskWorktree: "oly-tasks-launch-wt",
  taskBoard: "oly-tasks-launch-board",
  taskAutostart: "oly-tasks-autostart",
  modelFilter: "oly-openrouter-filter",
} as const;

type PreferenceKey = typeof preferenceKeys[keyof typeof preferenceKeys];
export type PreferenceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readPreference(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function choiceValue(raw: string | null, options: readonly string[]) {
  return raw !== null && options.includes(raw) ? raw : options[0]!;
}

function panelState(raw: string | null): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw ?? "null");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return { ...parsed };
  } catch {}
  return {};
}

export function followsChat(raw: string | null) {
  return panelState(raw).follow !== false;
}

export function modelFilter(raw: string | null) {
  try {
    const filter: unknown = JSON.parse(raw ?? "null");
    return typeof filter === "string" ? filter : null;
  } catch { return null; }
}

type Panels = { state: { P: { follow: boolean } }; toggleFollow(): void };

export function writePreference(storage: PreferenceStorage, key: PreferenceKey, value: string, panels?: Panels) {
  if (key === preferenceKeys.follow) {
    const follow = value === "1";
    if (panels) {
      if (panels.state.P.follow !== follow) panels.toggleFollow();
    } else {
      storage.setItem(key, JSON.stringify({ ...panelState(storage.getItem(key)), follow }));
    }
  } else if (key === preferenceKeys.downloads && value === "auto") {
    storage.removeItem(key);
  } else {
    storage.setItem(key, key === preferenceKeys.modelFilter ? JSON.stringify(value) : value);
  }
}

export function writeFeature(storage: PreferenceStorage, id: FeatureId, on: boolean) {
  if (on) storage.removeItem(featureKey(id));
  else storage.setItem(featureKey(id), "0");
}

// The Olympus notification module already listens for this key in other windows.
// Storage writes in this window need the same signal.
export function notifyPreferenceChange(key: string, value: string | null) {
  window.dispatchEvent(new StorageEvent("storage", { key, newValue: value, storageArea: localStorage }));
}

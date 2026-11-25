import { useRightPanelStore, type ThreadRightPanelState } from "../../../rightPanelStore";
import { nativeId, olympusId, olympusSurface } from "../panelSurfaces";

type State = ReturnType<typeof useRightPanelStore.getState>;
function legacyThread(panel: ThreadRightPanelState) {
  return { ...panel, activeSurfaceId: olympusId(panel.activeSurfaceId), surfaces: panel.surfaces.map(olympusSurface) };
}
type LegacyThreads = Record<string, ReturnType<typeof legacyThread>>;
const snapshots = new WeakMap<State["byThreadKey"], LegacyThreads>();
const panels = new WeakMap<ThreadRightPanelState, ReturnType<typeof legacyThread>>();

function adapt(state: State) {
  let byThreadKey = snapshots.get(state.byThreadKey);
  if (!byThreadKey) {
    byThreadKey = Object.create(null) as LegacyThreads;
    for (const [key, panel] of Object.entries(state.byThreadKey)) {
      const legacy = panels.get(panel) ?? legacyThread(panel);
      panels.set(panel, legacy);
      byThreadKey[key] = legacy;
    }
    snapshots.set(state.byThreadKey, byThreadKey);
  }
  return {
    byThreadKey,
    openSideChat: state.openThread,
    activateSurface: (ref: Parameters<State["activateSurface"]>[0], id: string) => state.activateSurface(ref, nativeId(id)),
    closeSurface: (ref: Parameters<State["closeSurface"]>[0], id: string) => state.closeSurface(ref, nativeId(id)),
    show: state.show,
  };
}

type Listener = (current: ReturnType<typeof adapt>, previous: ReturnType<typeof adapt>) => void;
// Olympus reads snapshots and subscribes to tab changes; the native store alone owns writes.
export const d = {
  getState: () => adapt(useRightPanelStore.getState()),
  subscribe: (listener: Listener) => useRightPanelStore.subscribe((state, previous) => listener(adapt(state), adapt(previous))),
};

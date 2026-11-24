import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useRightPanelStore } from "../../rightPanelStore";
import { applyOlympusCatalog } from "./l10n/catalog";
import { nativeSurface, olympusSurface } from "./panelSurfaces";
import { d } from "./shims/rightPanelStore";

describe("Olympus 4774 on upstream 5209", () => {
  it("keeps saved split identifiers across native tab changes and renders both directions", () => {
    const ref = scopeThreadRef(EnvironmentId.make("compat"), ThreadId.make("main"));
    const child = ThreadId.make("child");
    const key = scopedThreadKey(ref);
    const state = useRightPanelStore.getState();
    try {
      d.getState().openSideChat(ref, child);
      const native = useRightPanelStore.getState().byThreadKey[key]!.surfaces[0]!;
      const legacy = d.getState().byThreadKey[key]!.surfaces[0]!;
      expect(legacy).toEqual({ id: "side-chat:child", kind: "side-chat", threadId: child });
      expect(nativeSurface(legacy)).toEqual(native);
      expect(olympusSurface(native)).toEqual(legacy);
      d.getState().activateSurface(ref, legacy.id);
      expect(d.getState().byThreadKey[key]!.activeSurfaceId).toBe(legacy.id);
      d.getState().closeSurface(ref, legacy.id);
      expect(useRightPanelStore.getState().byThreadKey[key]?.surfaces ?? []).toEqual([]);
    } finally {
      useRightPanelStore.setState(state, true);
    }
  });

  it("preserves GT identifiers, named variables, rich nodes and native plural rules", () => {
    const node = { i: 1, k: "_gt_value_1", v: "v" };
    const en = { a: "Thread", b: "From {src} to {dst}", c: ["Open ", node], d: "{n, plural, other {# files}}" };
    const ru = { a: "Ветка", b: "", c: [node], d: "штатная форма" };
    expect(applyOlympusCatalog(en, ru, {
      Thread: "Тред", "From ${x} to ${y}": "В ${y} из ${x}", "Open ${target}": "Открыть ${target}",
    })).toBe(3);
    expect(ru).toEqual({ a: "Тред", b: "В {dst} из {src}", c: ["Открыть ", node], d: "штатная форма" });
  });
});

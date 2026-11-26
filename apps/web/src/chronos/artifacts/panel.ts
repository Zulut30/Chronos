import { rightPanelHostRef, useRightPanelStore } from "~/rightPanelStore";
import { resolveThreadRouteTarget } from "~/threadRoutes";

export async function openArtifactTab(url: string) {
  const route = (window as Window & {
    __TSR_ROUTER__?: { state: { matches: {params: {environmentId?: string;threadId?: string}}[] } };
  }).__TSR_ROUTER__?.state.matches.at(-1);
  const target = resolveThreadRouteTarget(route?.params ?? {});
  if (target?.kind !== "server" || !window.desktopBridge) return false;
  useRightPanelStore.getState().openArtifacts(rightPanelHostRef(target.threadRef),url);
  return true;
}

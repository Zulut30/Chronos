import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { openUrlInPreview } from "~/browser/openFileInPreview";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { previewEnvironment } from "~/state/preview";
import { resolveThreadRouteTarget } from "~/threadRoutes";

export async function openArtifactTab(url: string) {
  const route = (window as Window & {
    __TSR_ROUTER__?: { state: { matches: {params: {environmentId?: string;threadId?: string}}[] } };
  }).__TSR_ROUTER__?.state.matches.at(-1);
  const target = resolveThreadRouteTarget(route?.params ?? {});
  if (target?.kind !== "server" || !window.desktopBridge) return false;
  const opened = await openUrlInPreview({
    url, threadRef:target.threadRef,
    openPreview: input => runAtomCommand(appAtomRegistry,previewEnvironment.open,input),
  });
  return opened._tag === "Success";
}

import type { RightPanelSurface, ThreadSurface } from "../../rightPanelStore";

type SideChat = Omit<ThreadSurface, "id" | "kind"> & { id: `side-chat:${string}`; kind: "side-chat" };
export type OlympusSurface = Exclude<RightPanelSurface, ThreadSurface> | SideChat;

export function olympusSurface(surface: RightPanelSurface): OlympusSurface {
  return surface.kind === "thread"
    ? { ...surface, id: `side-chat:${surface.threadId}`, kind: "side-chat" }
    : surface;
}

export function nativeSurface(surface: OlympusSurface): RightPanelSurface {
  return surface.kind === "side-chat"
    ? { ...surface, id: `thread:${surface.threadId}`, kind: "thread" }
    : surface;
}

export function olympusId(id: string | null) {
  return id?.replace(/^thread:/u, "side-chat:") ?? null;
}

export function nativeId(id: string) {
  return id.replace(/^side-chat:/u, "thread:");
}

import type { ComponentProps, ComponentType } from "react";
import { RightPanelSurfaceContent } from "../../components/chat/RightPanelSurfaceContent";
import { nativeId, nativeSurface, olympusId, olympusSurface, type OlympusSurface } from "./panelSurfaces";
import type { RightPanelSurface } from "../../rightPanelStore";

type NativeProps = ComponentProps<typeof RightPanelSurfaceContent>;
type OlympusProps = Omit<NativeProps, "surface"> & { surface: OlympusSurface | null };
export type OlympusPanelHost = ComponentType<OlympusProps & {
  __hj: ComponentType<OlympusProps>;
  __surfaces: readonly OlympusSurface[];
}>;

function NativeContent({ surface, activeSurfaceId, ...props }: OlympusProps) {
  return <RightPanelSurfaceContent {...props} surface={surface && nativeSurface(surface)} activeSurfaceId={activeSurfaceId && nativeId(activeSurfaceId)} />;
}

export function PanelHost({ surfaces, ...props }: NativeProps & { surfaces: readonly RightPanelSurface[] }) {
  const Olympus = globalThis.__olyPanelHost;
  if (!Olympus) return <RightPanelSurfaceContent {...props} />;
  return <Olympus {...props} __hj={NativeContent} __surfaces={surfaces.map(olympusSurface)}
    surface={props.surface && olympusSurface(props.surface)} activeSurfaceId={olympusId(props.activeSurfaceId)} />;
}

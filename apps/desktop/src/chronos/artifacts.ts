import type * as Electron from "electron";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Electron resolves the packaged preload before attaching a guest.
import * as NodePath from "node:path";

interface Runtime {
  attach(event: Electron.Event, prefs: Electron.WebPreferences, params: {src?:string;partition?:string}): void;
  protect(contents: Electron.WebContents): boolean;
}
let runtime: Runtime | undefined;
export function attachArtifact(event: Electron.Event, prefs: Electron.WebPreferences, params: {src?:string;partition?:string}) {
  if (!params.partition?.startsWith("persist:chronos-artifact-")) return false;
  runtime ??= require(NodePath.join(process.resourcesPath,"chronos-services","artifacts","runtime.cjs")) as Runtime;
  runtime.attach(event,prefs,params);
  return true;
}
export function protectArtifact(contents: Electron.WebContents) {
  return runtime?.protect(contents) ?? false;
}

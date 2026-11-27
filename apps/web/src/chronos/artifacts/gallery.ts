import russianWords from "../../../../../chronos/l10n/artifacts.ru.json";
import englishWords from "../../../../../chronos/l10n/artifacts.en.json";
import { getActiveLocale } from "../../i18n/messages";

export function getArtifactWords(locale = getActiveLocale()): typeof russianWords {
  return locale.startsWith("ru") ? russianWords : englishWords;
}
export const galleryUrl = "http://127.0.0.1:4520/artifacts.html";
const viewer = "http://127.0.0.1:4520/artifact-view.html?id=";
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export function artifactId(raw: string | null | undefined) {
  if (!raw?.startsWith(viewer)) return null;
  const id = raw.slice(viewer.length);
  return uuid.test(id) ? id : null;
}
export function artifactUrl(id:string) {return viewer+id;}

export async function openArtifactsUrl(url:string) {
  if (!window.desktopBridge) {
    const studio = window as Window & {
      __olyStudioShell?:{open(url:string,title:string):Promise<unknown>};
      __olyStudio?:{openInPanel(url:string,options:{title:string}):Promise<unknown>};
    };
    const target = new URL(url);
    if (target.pathname === "/artifacts.html") {
      const root = document.documentElement;
      const colors = getComputedStyle(root);
      const theme = new URLSearchParams({theme:root.classList.contains("dark") ? "dark" : "light"});
      for (const [key, token] of Object.entries({bg:"background",fg:"foreground",panel:"card",border:"border",accent:"accent",primary:"primary"})) {
        theme.set(key,colors.getPropertyValue("--"+token).trim());
      }
      target.hash = theme.toString();
      url = target.href;
    }
    const words = getArtifactWords();
    const title = artifactId(url) ? words.viewer : words.library;
    if (studio.__olyStudioShell) await studio.__olyStudioShell.open(url,title);
    else if (studio.__olyStudio) await studio.__olyStudio.openInPanel(url,{title});
    else window.open(url,"_blank","noopener");
    return;
  }
  const {openArtifactTab} = await import("./panel");
  if (await openArtifactTab(url)) {
    const frame=document.querySelector<HTMLIFrameElement>("[data-oly-studio-overlay] iframe");
    if (frame && (artifactId(frame.src) || frame.src.startsWith(galleryUrl))) {
      (window as Window & {__olyStudioShell?:{close():void}}).__olyStudioShell?.close();
    }
    return;
  }
  const {openLibraryDialog} = await import("./Library");
  openLibraryDialog(url);
}
export const openArtifactGallery = () => openArtifactsUrl(galleryUrl);
export function onArtifactRequest(event:Event) {
  const [action,id,...extra] = String((event as CustomEvent).detail).split("/");
  if (extra.length || (action !== "open" && action !== "delete") || !id || !uuid.test(id)) return;
  void openArtifactsUrl(action === "delete" ? galleryUrl+"?delete="+id : viewer+id);
}

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
  const {openArtifactTab} = await import("./panel");
  if (await openArtifactTab(url)) return;
  const {openLibraryDialog} = await import("./Library");
  openLibraryDialog(url);
}
export const openArtifactGallery = () => openArtifactsUrl(galleryUrl);
export function onArtifactRequest(event:Event) {
  const [action,id] = String((event as CustomEvent).detail).split("/");
  if (!id || !uuid.test(id)) return;
  void openArtifactsUrl(action === "delete" ? galleryUrl+"?delete="+id : viewer+id);
}

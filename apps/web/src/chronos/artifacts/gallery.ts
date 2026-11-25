interface Studio {
  __olyStudio?: { openInPanel(url: string, options: { title: string }): Promise<unknown> };
  __olyStudioShell?: {open(url: string,title: string):Promise<unknown>;close():void};
}
export async function openArtifactsUrl(url: string,title: string) {
  const { openArtifactTab } = await import("./panel");
  const studio = window as Window & Studio;
  if (await openArtifactTab(url)) {
    studio.__olyStudioShell?.close();
    return;
  }
  if (studio.__olyStudioShell) return studio.__olyStudioShell.open(url,title);
  return studio.__olyStudio?.openInPanel(url,{title});
}
export function openArtifactGallery() {
  return openArtifactsUrl("http://127.0.0.1:4520/artifacts.html","Артефакты");
}

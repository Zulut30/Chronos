export async function openArtifactGallery() {
  const studio = (window as Window & {
    __olyStudio?: { openInPanel(url: string, options: { title: string }): Promise<unknown> };
  }).__olyStudio;
  const url = "http://127.0.0.1:4520/artifacts.html";
  const { openArtifactTab } = await import("./panel");
  if (await openArtifactTab(url)) return;
  return studio?.openInPanel(url, { title: "Артефакты" });
}

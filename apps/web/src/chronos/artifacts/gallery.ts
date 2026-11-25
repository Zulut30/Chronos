export function openArtifactGallery() {
  const studio = (window as Window & {
    __olyStudio?: { openInPanel(url: string, options: { title: string }): Promise<unknown> };
  }).__olyStudio;
  return studio?.openInPanel("http://127.0.0.1:4520/artifacts.html", { title: "Артефакты" });
}

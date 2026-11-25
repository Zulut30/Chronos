import { useEffect, useRef } from "react";

const origin = "http://127.0.0.1:4520";
export function artifactId(raw: string | null) {
  const url = raw && URL.parse(raw);
  if (!url || url.origin !== origin || url.pathname !== "/artifact-view.html") return null;
  const id = url.searchParams.get("id");
  return id && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id) ? id : null;
}

export function mountArtifact(parent: HTMLElement,id: string) {
  const guest = document.createElement("webview");
  guest.setAttribute("partition","persist:chronos-artifact-"+id);
  guest.setAttribute("src","chronos-artifact://"+id+"/index.html");
  Object.assign(guest.style,{display:"flex",width:"100%",height:"100%",flex:"1",minHeight:"0"});
  let ready = false;
  const root = document.documentElement;
  function sendTheme() {
    if (!ready) return;
    const style = getComputedStyle(root);
    const tokens = Object.fromEntries(["background","foreground","card","primary","primary-foreground","border","accent","muted-foreground"]
      .map(key => ["--"+key,style.getPropertyValue("--"+key).trim()]));
    void (guest as unknown as {send(channel:string,data:unknown):Promise<void>})
      .send("chronos:artifact-theme",{mode:root.classList.contains("dark") ? "dark" : "light",tokens}).catch(()=>{});
  }
  guest.addEventListener("dom-ready",()=>{ready=true;sendTheme();});
  const observer = new MutationObserver(sendTheme);
  observer.observe(root,{attributes:true,attributeFilter:["class","style","data-theme-id"]});
  parent.append(guest);
  return () => {observer.disconnect();guest.remove();};
}

export function ArtifactView({id}:{id:string}) {
  const box = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- attach an isolated Electron guest for the panel lifetime.
  useEffect(()=>{if(box.current) return mountArtifact(box.current,id);},[id]);
  return <div ref={box} className="absolute inset-0" />;
}

// Studio falls back to its dialog when there is no active thread.
export function watchArtifactDialog() {
  if (!window.desktopBridge) return;
  let current: HTMLIFrameElement | null = null;
  let dispose: (()=>void) | undefined;
  const observer = new MutationObserver(() => {
    const frame = document.querySelector<HTMLIFrameElement>("[data-oly-studio-overlay] iframe");
    if (frame === current) return;
    dispose?.();
    current = frame;
    const id = artifactId(frame?.src ?? null);
    if (frame && id && frame.parentElement) {
      frame.hidden = true;
      frame.style.display = "none";
      dispose = mountArtifact(frame.parentElement,id);
    }
  });
  observer.observe(document.documentElement,{childList:true,subtree:true});
  return () => {observer.disconnect();dispose?.();};
}

import { useEffect, useRef } from "react";

export function readTheme() {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const tokens = Object.fromEntries(["background","foreground","card","primary","primary-foreground","border","accent","muted-foreground"]
    .map(key => ["--"+key,style.getPropertyValue("--"+key).trim()]));
  return {mode:root.classList.contains("dark") ? "dark" : "light",tokens};
}

export function ArtifactView({id,historic}:{id:string;historic:number | null}) {
  const box = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the isolated guest and theme subscription live exactly as long as the visible preview.
  useEffect(() => {
    if (!box.current) return;
    const guest = document.createElement("webview");
    guest.setAttribute("partition",historic ? "chronos-artifact-history-"+id+"-"+historic : "persist:chronos-artifact-"+id);
    guest.setAttribute("src","chronos-artifact://"+id+"/index.html");
    guest.style.cssText = "display:flex;width:100%;height:100%";
    let ready = false;
    const send = () => {
      if (ready) void (guest as unknown as {send(channel:string,theme:unknown):Promise<void>}).send("chronos:artifact-theme",readTheme()).catch(()=>{});
    };
    guest.addEventListener("dom-ready",()=>{ready=true;send();});
    const observer = new MutationObserver(send);
    observer.observe(document.documentElement,{attributes:true,attributeFilter:["class","style","data-theme-id"]});
    box.current.append(guest);
    return () => {observer.disconnect();guest.remove();};
  },[id,historic]);
  return <div ref={box} className="min-h-0 flex-1" />;
}

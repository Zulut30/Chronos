import { useEffect, useRef } from "react";
import { desktopError } from "../desktopError";

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
  function readTheme() {
    const style = getComputedStyle(root);
    const tokens = Object.fromEntries(["background","foreground","card","primary","primary-foreground","border","accent","muted-foreground"]
      .map(key => ["--"+key,style.getPropertyValue("--"+key).trim()]));
    return {mode:root.classList.contains("dark") ? "dark" : "light",tokens};
  }
  function sendTheme() {
    if (!ready) return;
    void (guest as unknown as {send(channel:string,data:unknown):Promise<void>})
      .send("chronos:artifact-theme",readTheme()).catch(()=>{});
  }
  guest.addEventListener("dom-ready",()=>{ready=true;sendTheme();});
  const observer = new MutationObserver(sendTheme);
  observer.observe(root,{attributes:true,attributeFilter:["class","style","data-theme-id"]});
  const panel = document.createElement("div");
  Object.assign(panel.style,{height:"100%",width:"100%",minHeight:"0",display:"flex",flexDirection:"column",flex:"1"});
  const installer = (window as Window & {chronosArtifactInstaller?: {
    metadata(id:string):Promise<string>; installed(id:string):Promise<boolean>; remove(id:string):Promise<void>;
    install(id:string,icon:string,theme:ReturnType<typeof readTheme>):Promise<boolean>;
  }}).chronosArtifactInstaller;
  if (installer) {
    const bar=document.createElement("div");
    bar.className="flex flex-wrap items-center justify-end gap-2 border-b bg-background px-3 py-1 text-foreground";
    const button=document.createElement("button"), status=document.createElement("span");
    status.setAttribute("role","status");
    button.type="button";
    const remove=document.createElement("button");
    remove.type="button";
    remove.textContent="Удалить ярлыки";
    for (const control of [button,remove]) control.className="rounded border bg-card px-2 py-1 text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring";
    remove.hidden=true;
    function installed(value:boolean) {
      button.textContent=value ? "Обновить ярлыки" : "Установить как приложение";
      remove.hidden=!value;
    }
    button.textContent="Установить как приложение";
    button.disabled=true;
    void installer.installed(id).then(installed)
      .catch(e=>{status.textContent=desktopError(e,"Не удалось проверить ярлыки.");})
      .finally(()=>{button.disabled=false;});
    remove.onclick=async () => {
      button.disabled=remove.disabled=true;
      try {
        await installer.remove(id);
        installed(false);
        status.textContent="Ярлыки удалены. Артефакт сохранён в галерее.";
        button.disabled=false;
        button.focus();
      } catch (e) {status.textContent=desktopError(e,"Не удалось удалить ярлыки.");}
      finally {button.disabled=remove.disabled=false;}
    };
    button.onclick=async () => {
      button.disabled=remove.disabled=true;
      try {
        const icon=await installer.metadata(id);
        const canvas=document.createElement("canvas");
        canvas.width=canvas.height=64;
        const ctx=canvas.getContext("2d");
        if (!ctx) throw Error("Не удалось создать значок");
        ctx.fillStyle="#40435e";ctx.fillRect(0,0,64,64);ctx.fillStyle="white";
        ctx.font="38px Segoe UI Emoji, sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";
        ctx.fillText(Array.from(icon).slice(0,6).join(""),32,33,58);
        await installer.install(id,canvas.toDataURL(),readTheme());
        installed(true);
        status.textContent="Ярлыки добавлены в «Пуск» и на рабочий стол";
      } catch(e) {status.textContent=desktopError(e,"Не удалось установить приложение.");}
      finally {button.disabled=remove.disabled=false;}
    };
    bar.append(status,button,remove);panel.append(bar);
  }
  panel.append(guest);parent.append(panel);
  return () => {observer.disconnect();panel.remove();};
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
  const show = (event: Event) => {
    const match = /^(open|delete)\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/.exec(String((event as CustomEvent).detail));
    if (!match) return;
    const confirm = match[1] === "delete";
    const url = origin+(confirm ? "/artifacts.html?delete=" : "/artifact-view.html?id=")+match[2];
    void import("./gallery").then(({openArtifactsUrl})=>openArtifactsUrl(url,confirm ? "Артефакты" : "Просмотр артефакта"));
  };
  window.addEventListener("chronos:show-artifact",show);
  let current: HTMLIFrameElement | null = null;
  let dispose: (()=>void) | undefined;
  let dialog: Element | null = null;
  function refreshFrame() {
    const frame = dialog?.querySelector<HTMLIFrameElement>("iframe") ?? null;
    if (frame === current) return;
    dispose?.();
    dispose = undefined;
    current = frame;
    const id = artifactId(frame?.src ?? null);
    if (frame && (id || frame.src.startsWith(origin+"/artifacts.html"))) {
      // Studio also uses the dialog when its preview RPC times out in an active thread.
      void import("./panel").then(async ({openArtifactTab}) => {
        if (frame === current && frame.isConnected && await openArtifactTab(frame.src) && frame === current && frame.isConnected) {
          (window as Window & {__olyStudioShell?: {close():void}}).__olyStudioShell?.close();
        }
      }).catch(()=>{});
    }
    if (frame && id && frame.parentElement) {
      frame.hidden = true;
      frame.style.display = "none";
      dispose = mountArtifact(frame.parentElement,id);
    }
  }
  const frames = new MutationObserver(refreshFrame);
  function observeDialog(next: Element | null) {
    frames.disconnect();
    dialog = next;
    if (dialog) frames.observe(dialog, { childList: true });
    refreshFrame();
  }
  // Studio appends its dialog to body, then replaces the loading state with a direct iframe.
  const selector = "[data-oly-studio-overlay]";
  const dialogs = new MutationObserver((records) => {
    if (dialog && dialog.parentNode !== document.body) observeDialog(null);
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element && node.parentNode === document.body && node.matches(selector)) observeDialog(node);
      }
    }
  });
  dialogs.observe(document.body, { childList: true });
  observeDialog(document.body.querySelector(":scope > " + selector));
  return () => {
    window.removeEventListener("chronos:show-artifact",show);
    dialogs.disconnect();
    observeDialog(null);
  };
}

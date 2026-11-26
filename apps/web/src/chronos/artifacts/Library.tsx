import { useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ArrowLeft, ArrowUpRight, Check, Code2, Copy, Download, Ellipsis, ExternalLink, FileCode2, LockKeyhole, Pin, RotateCcw, Search, Trash2, X } from "lucide-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { readThreadShell } from "~/state/entities";
import { useRightPanelSurfaceClose } from "~/hooks/useRightPanelSurfaceClose";
import { selectThreadRightPanelState, useRightPanelStore } from "~/rightPanelStore";
import words from "../../../../../chronos/l10n/artifacts.ru.json";
import { ArtifactView, readTheme } from "./ArtifactView";
import { artifactId, artifactUrl, galleryUrl } from "./gallery";
import "./library.css";

type Card = {id:string;title:string;description:string;icon:string;updated:number;pinned:number;version:number};
type Details = Card & {history:{version:number;label:string}[];origin:ScopedThreadRef|null};
type Files = Record<string,string | {encoding:"base64";data:string}>;
type Bridge = Window & {
  chronosArtifactLibrary:{request(action:string,args:unknown):Promise<unknown>};
  chronosArtifactInstaller?:{install(id:string,image:string,theme:unknown):Promise<boolean>};
  __TSR_ROUTER__?:{navigate(input:{to:string;search?:Record<string,string>}):Promise<void>};
};
const bridge = () => window as Bridge;
function request<T>(action:string,args:Record<string,unknown> = {}) {
  return bridge().chronosArtifactLibrary.request(action,args) as Promise<T>;
}
const message = (error:unknown) => error instanceof Error ? error.message : String(error);

function IconButton({label,onClick,children,pressed}:{label:string;onClick:()=>void;children:ReactNode;pressed?:boolean}) {
  return <button type="button" className="art-icon" title={label} aria-label={label} aria-pressed={pressed} onClick={onClick}>{children}</button>;
}

function Gallery({open,onClose,confirmId}:{open:(id:string)=>void;onClose:()=>void;confirmId:string|null}) {
  const [trash,setTrash] = useState(false);
  const [query,setQuery] = useState("");
  const [oldest,setOldest] = useState(false);
  const [cards,setCards] = useState<Card[]>([]);
  const [revision,refresh] = useState(0);
  const [error,setError] = useState("");
  const [undo,setUndo] = useState<Card|null>(null);
  const [confirmation,confirm] = useState(confirmId);
  const grid = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- read this profile only while the gallery is open.
  useEffect(() => {
    let current = true;
    void request<Card[]>("list",{trash}).then(rows => {if (current) setCards(rows);}, e => {if(current)setError(message(e));});
    return () => {current=false;};
  },[trash,revision]);
  const matches = cards.filter(card => (card.title+" "+card.description).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a,b)=>b.pinned-a.pinned || (oldest ? a.updated-b.updated : b.updated-a.updated));
  const imageKeys = matches.map(a=>a.id+"."+a.version).join(",");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- capture visible cards serially and stop requesting images on unmount.
  useEffect(() => {
    if (!grid.current || trash) return;
    const pending = new Set<HTMLImageElement>();
    let active = true, running = false;
    async function drain() {
      if (running) return;
      running=true;
      while(active && pending.size) {
        const img = pending.values().next().value!;
        pending.delete(img);
        try {
          const jpeg = await request<string|null>("thumbnail",{id:img.dataset.id,version:Number(img.dataset.version)});
          if(active && jpeg) img.src="data:image/jpeg;base64,"+jpeg;
        } catch { /* The card remains usable if its source cannot be painted. */ }
      }
      running=false;
    }
    const observer = new IntersectionObserver(entries=>{
      for(const entry of entries) {
        const img=entry.target as HTMLImageElement;
        if(entry.isIntersecting && !img.hasAttribute("src")) pending.add(img);
        else pending.delete(img);
      }
      void drain();
    });
    grid.current.querySelectorAll("img").forEach(img=>observer.observe(img));
    return () => {active=false;observer.disconnect();};
  },[imageKeys,trash]);
  async function change(action:string,card:Card) {
    try {
      await request(action,{id:card.id,pinned:!card.pinned,expectedVersion:card.version});
      if(action==="trash") setUndo(card);
      if(action==="recover") setUndo(null);
      setError("");refresh(n=>n+1);
    } catch(e){setError(message(e));}
  }
  const selected = cards.find(a=>a.id===confirmation);
  return <section className="art-shell art-library" data-artifact-gallery="">
    <header className="art-head"><div><h1>{trash ? words.trash : words.library}</h1><small><LockKeyhole/>{words.private}</small></div>
      <div className="art-tools"><IconButton label={trash ? words.libraryBack : words.trash} pressed={trash} onClick={()=>{setCards([]);setTrash(!trash);}}>{trash ? <ArrowLeft/> : <Trash2/>}</IconButton>
      <IconButton label={words.close} onClick={onClose}><X/></IconButton></div></header>
    <div className="art-filter"><label><Search/><input aria-label={words.search} placeholder={words.search} value={query} onChange={e=>setQuery(e.target.value)}/></label>
      <select aria-label={words.sort} value={oldest?"old":"new"} onChange={e=>setOldest(e.target.value==="old")}><option value="new">{words.recent}</option><option value="old">{words.oldest}</option></select></div>
    {selected && <div className="art-notice">{words.confirm} «{selected.title}»? <button onClick={()=>{void change("trash",selected);confirm(null);}}>{words.confirm}</button><button onClick={()=>confirm(null)}>{words.cancel}</button></div>}
    {undo && <div role="status" className="art-notice">{words.moved} <button onClick={()=>void change("recover",undo)}>{words.undo}</button></div>}
    {error && <p role="alert">{error}</p>}
    <div ref={grid} className="art-grid">{matches.map(a=><article key={a.id+"."+a.version} className="art-card">
      <button className="art-cover" disabled={trash} onClick={()=>open(a.id)} aria-label={a.title}><FileCode2/><img data-id={a.id} data-version={a.version} alt=""/></button>
      <div className="art-summary"><button className="art-title" disabled={trash} onClick={()=>open(a.id)}>{a.title}</button><p>{a.description}</p>
      <footer><small>HTML · {words.version} {a.version}</small><div className="art-tools">
        {trash ? <IconButton label={words.restore} onClick={()=>void change("recover",a)}><RotateCcw/></IconButton> : <>
        <IconButton label={a.pinned ? words.unpin : words.pin} pressed={!!a.pinned} onClick={()=>void change("pin",a)}><Pin/></IconButton>
        <IconButton label={words.remove} onClick={()=>void change("trash",a)}><Trash2/></IconButton></>}</div></footer></div>
    </article>)}</div>{matches.length===0 && <p className="art-empty">{query ? words.noResults : trash ? words.emptyTrash : words.empty}</p>}
  </section>;
}

async function install(card:Details) {
  const canvas = document.createElement("canvas");
  canvas.width=canvas.height=64;
  const ctx=canvas.getContext("2d");
  if (!ctx) throw Error("Не удалось создать значок");
  ctx.fillStyle="#434138";ctx.fillRect(0,0,64,64);ctx.fillStyle="#fff";
  ctx.font="36px Segoe UI Emoji,sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";
  ctx.fillText(/^\p{L}/u.test(card.icon) ? card.title.slice(0,1) : card.icon,32,33,58);
  await bridge().chronosArtifactInstaller?.install(card.id,canvas.toDataURL(),readTheme());
}
async function download(files:Files,title:string) {
  let blob:Blob;
  const single = Object.keys(files).length===1 && typeof files["index.html"]==="string";
  if(single) blob = new Blob([files["index.html"] as string],{type:"text/html;charset=utf-8"});
  else {
    const {default:Zip}=await import("jszip");
    const zip=new Zip();
    for (const [path,data] of Object.entries(files)) {
      if(typeof data==="string") zip.file(path,data);
      else zip.file(path,data.data,{base64:true});
    }
    blob=await zip.generateAsync({type:"blob"});
  }
  const url=URL.createObjectURL(blob), link=document.createElement("a");
  link.href=url;link.download=title+(single?".html":".zip");link.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function Viewer({id,back,onClose}:{id:string;back:()=>void;onClose:()=>void}) {
  const [details,setDetails]=useState<Details|null>(null);
  const [version,setVersion]=useState(0);
  const [code,setCode]=useState(false);
  const [files,setFiles]=useState<Files|null>(null);
  const [file,setFile]=useState("index.html");
  const [status,setStatus]=useState("");
  const [revision,refresh]=useState(0);
  const [menu,setMenu]=useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- load the selected artifact metadata and head after restore.
  useEffect(()=>{
    let current=true;
    void request<Details>("details",{id}).then(result=>{if(current){setDetails({...result,id});setVersion(result.version);}},e=>{if(current)setStatus(message(e));});
    return ()=>{current=false;};
  },[id,revision]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- file bytes are requested only when the reader selects code.
  useEffect(()=>{
    if(!code || !version) return;
    let current=true;
    void request<Files>("files",{id,version}).then(result=>{if(current)setFiles(result);},e=>{if(current)setStatus(message(e));});
    return ()=>{current=false;};
  },[id,version,code]);
  const run=(fn:()=>Promise<void>)=>{setMenu(false);setStatus("");void fn().catch(e=>setStatus(message(e)));};
  const selectedFiles=()=>files ?? request<Files>("files",{id,version});
  async function continueInChat() {
    if(!details) return;
    const origin=details.origin;
    const thread=origin && readThreadShell(scopeThreadRef(origin.environmentId,origin.threadId));
    const router=bridge().__TSR_ROUTER__;
    if(!router) throw Error("Не удалось открыть чат");
    if(thread && !thread.deletedAt && !thread.archivedAt && origin) {
      await router.navigate({to:"/"+encodeURIComponent(origin.environmentId)+"/"+encodeURIComponent(origin.threadId)});
    } else {
      const prompt="Продолжим работу над артефактом «"+details.title+"». "+artifactUrl(id)+" · "+words.version+" "+version;
      await router.navigate({to:"/new",search:{prompt}});
    }
    onClose();
  }
  const content = files?.[file];
  return <section className="art-shell art-view" data-artifact-view="">
    <header className="art-head"><IconButton label={words.libraryBack} onClick={back}><ArrowLeft/></IconButton>
      <h2>{details?.title ?? words.loading}</h2><div className="art-tools">
        <IconButton label={words.actions} pressed={menu} onClick={()=>setMenu(!menu)}><Ellipsis/></IconButton>
        <IconButton label={words.close} onClick={onClose}><X/></IconButton></div></header>
    {details && <><div className="art-controls"><div className="art-segment">
      <button aria-pressed={!code} onClick={()=>setCode(false)}>{words.preview}</button>
      <button aria-pressed={code} onClick={()=>setCode(true)}><Code2/>{words.code}</button></div>
      <select aria-label={words.version} value={version} onChange={e=>{setFiles(null);setFile("index.html");setVersion(Number(e.target.value));}}>
        {details.history.map(v=><option key={v.version} value={v.version}>{words.version} {v.version} · {v.label}</option>)}</select>
      {version!==details.version && <button onClick={()=>run(async()=>{await request("restore",{id,version,expectedVersion:details.version});refresh(n=>n+1);})}>{words.restore}</button>}
    </div>
    {menu && <div className="art-menu"><button onClick={()=>run(async()=>{const src=(await selectedFiles())[file];if(typeof src==="string") await navigator.clipboard.writeText(src);else if(src) await navigator.clipboard.writeText(src.data);setStatus(words.copied);})}><Copy/>{words.copy}</button>
      <button onClick={()=>run(async()=>download(await selectedFiles(),details.title))}><Download/>{words.download}</button>
      <button onClick={()=>run(()=>request<void>("openWindow",{id}))}><ExternalLink/>{words.window}</button>
      {bridge().chronosArtifactInstaller && <button onClick={()=>run(async()=>{await install(details);setStatus(words.installed);})}><Check/>{words.install}</button>}
    </div>}
    {code ? <div className="art-code">{files && Object.keys(files).length>1 && <select aria-label={words.source} value={file} onChange={e=>setFile(e.target.value)}>{Object.keys(files).map(name=><option key={name}>{name}</option>)}</select>}
      <pre>{!files ? words.loading : typeof content==="string" ? content : words.binary}</pre></div>
      : <ArtifactView key={version} id={id} historic={version===details.version?null:version}/>}
    <footer className="art-bottom"><small><LockKeyhole/>{words.private}</small><button onClick={()=>run(continueInChat)}>{words.chat}<ArrowUpRight/></button></footer>
    </>}{status && <p role="status" className="art-notice">{status}</p>}</section>;
}
function Library({url,onClose}:{url:string;onClose:()=>void}) {
  const [id,select]=useState(()=>artifactId(url));
  return id ? <Viewer key={id} id={id} back={()=>select(null)} onClose={onClose}/> :
    <Gallery open={select} onClose={onClose} confirmId={new URL(url).searchParams.get("delete")}/>;
}
const emptyLabels = new Map<string,string>();
export function ArtifactTab({url,threadRef,tabId}:{url:string;threadRef:ScopedThreadRef;tabId:string}) {
  const {closeSurface}=useRightPanelSurfaceClose({threadRef,terminalLabelsById:emptyLabels});
  const close=()=>{
    const tab=selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey,threadRef).surfaces
      .find(s=>s.kind==="preview" && s.resourceId===tabId);
    if(tab) closeSurface(tab);
  };
  return <Library key={url} url={url} onClose={close}/>;
}
let dialog:HTMLDialogElement | null=null, root:Root|null=null;
export function openLibraryDialog(url=galleryUrl) {
  if(!dialog){
    dialog=document.createElement("dialog");dialog.className="art-dialog";dialog.setAttribute("aria-label",words.library);
    document.body.append(dialog);root=createRoot(dialog);
    dialog.addEventListener("close",()=>{root?.unmount();root=null;dialog?.remove();dialog=null;},{once:true});
    dialog.showModal();
  }
  root?.render(<Library key={url} url={url} onClose={()=>dialog?.close()}/>);
}

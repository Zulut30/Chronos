import "../settingsSelect.css";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ArrowLeft, ArrowUpRight, Check, Code2, Copy, Download, Ellipsis, ExternalLink, FileCode2, LockKeyhole, Pin, RotateCcw, Trash2, X } from "lucide-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { readThreadShell } from "~/state/entities";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../components/ui/select";
import { desktopError } from "../desktopError";
import { ArtifactView, readTheme } from "./ArtifactView";
import { artifactId, artifactUrl, galleryUrl, getArtifactWords } from "./gallery";
import "./library.css";

type Card = {id:string;title:string;description:string;icon:string;updated:number;pinned:number;version:number};
type Details = Card & {history:{version:number;label:string}[];origin:ScopedThreadRef|null};
type Files = Record<string,string | {encoding:"base64";data:string}>;
type Bridge = Window & {
  chronosArtifactLibrary:{request(action:string,args:unknown):Promise<unknown>};
  chronosArtifactInstaller?:{installed(id:string):Promise<boolean>;remove(id:string):Promise<void>;install(id:string,image:string,theme:unknown):Promise<boolean>};
  __TSR_ROUTER__?:{navigate(input:{to:string;search?:Record<string,string>}):Promise<void>};
};
const bridge = () => window as unknown as Bridge;
function request<T>(action:string,args:Record<string,unknown> = {}) {
  return bridge().chronosArtifactLibrary.request(action,args) as Promise<T>;
}
const message = (error:unknown) => desktopError(error,getArtifactWords().actionFailed);

function IconButton({label,onClick,children,pressed}:{label:string;onClick:()=>void;children:ReactNode;pressed?:boolean}) {
  return <Button type="button" variant="ghost" size="icon-sm" title={label} aria-label={label} aria-pressed={pressed} data-pressed={pressed || undefined} onClick={onClick}>{children}</Button>;
}

function ArtifactSelect({ label, value, options, onChange, container, triggerRef }: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  container?: HTMLElement | undefined;
  triggerRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <Select value={value} items={options} onValueChange={(next) => { if (next !== null) onChange(next); }}>
      <SelectTrigger ref={triggerRef} size="sm" aria-label={label} className="w-auto max-w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectPopup data-chronos-settings-options="" portalContainer={container} align="end" alignItemWithTrigger={false}>
        {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
      </SelectPopup>
    </Select>
  );
}

function ConfirmTrash({card,cancel,remove}:{card:Card;cancel:()=>void;remove:()=>void}) {
  const words = getArtifactWords();
  const dialog=useRef<HTMLDialogElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- use the native modal focus trap and restore the invoking control on close.
  useLayoutEffect(()=>{
    const el=dialog.current;
    el?.showModal();
    el?.querySelector<HTMLButtonElement>('button[value="cancel"]')?.focus();
    return ()=>{el?.close();};
  },[]);
  return <dialog ref={dialog} className="art-confirm" aria-labelledby="artifact-trash-title"
    aria-describedby="artifact-trash-description" onCancel={event=>{event.preventDefault();cancel();}}>
    <h2 id="artifact-trash-title">{words.confirm} «{card.title}»?</h2>
    <p id="artifact-trash-description">{words.trashDescription}</p>
    <div><button value="cancel" onClick={cancel}>{words.cancel}</button>
      <button value="delete" onClick={remove}>{words.confirm}</button></div>
  </dialog>;
}

function Gallery({open,onClose,confirmId,container}:{container?:HTMLElement | undefined;open:(id:string)=>void;onClose:()=>void;confirmId:string|null}) {
  const words = getArtifactWords();
  const [trash,setTrash] = useState(false);
  const [query,setQuery] = useState("");
  const [oldest,setOldest] = useState(false);
  const [cards,setCards] = useState<Card[] | null>(null);
  const [revision,refresh] = useState(0);
  const [error,setError] = useState("");
  const [undo,setUndo] = useState<Card|null>(null);
  const [confirmation,confirm] = useState(confirmId);
  const grid = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const pinFocus = useRef<string|null>(null);
  const incoming = useRef(confirmId);
  useLayoutEffect(()=>{
    if (!pinFocus.current) return;
    grid.current?.querySelector<HTMLButtonElement>(`[data-id="${CSS.escape(pinFocus.current)}"] [aria-pressed]`)?.focus();
    pinFocus.current=null;
  },[cards]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- read this profile only while the gallery is open.
  useEffect(() => {
    let current = true;
    void request<Card[]>("list",{trash}).then(rows => {if (current) {
      setCards(rows);
      if (incoming.current && !rows.some(card=>card.id===incoming.current)) setError(words.alreadyRemoved);
      incoming.current=null;
    }}, e => {if(current)setError(message(e));});
    return () => {current=false;};
  },[trash,revision,confirmId]);
  const matches = (cards ?? []).filter(card => (card.title+" "+card.description).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
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
      if(action==="pin") pinFocus.current=card.id;
      if(action==="trash") {setUndo(card);search.current?.focus();}
      if(action==="recover") setUndo(null);
      setError("");refresh(n=>n+1);
    } catch(e){setError(message(e));}
  }
  const selected = cards?.find(a=>a.id===confirmation);
  return <section className="art-shell art-library" data-artifact-gallery="">
    <header className="art-head"><div><h1>{trash ? words.trash : words.library}</h1><small><LockKeyhole/>{words.private}</small></div>
      <div className="art-tools"><IconButton label={trash ? words.libraryBack : words.trash} pressed={trash} onClick={()=>{setCards(null);setError("");setTrash(!trash);}}>{trash ? <ArrowLeft/> : <Trash2/>}</IconButton>
      <IconButton label={words.close} onClick={onClose}><X/></IconButton></div></header>
    <div className="art-filter"><Input type="search" size="sm" className="min-w-40 flex-1" ref={search} aria-label={words.search} placeholder={words.search} value={query} onChange={e=>setQuery(e.target.value)}/>
      <ArtifactSelect container={container} label={words.sort} value={oldest ? "old" : "new"}
        options={[{value:"new", label:words.recent}, {value:"old", label:words.oldest}]}
        onChange={value => setOldest(value === "old")} /></div>
    {selected && <ConfirmTrash card={selected} cancel={()=>confirm(null)}
      remove={()=>{confirm(null);void change("trash",selected);}}/>}
    {undo && <div role="status" className="art-notice">{words.moved} <button onClick={()=>void change("recover",undo)}>{words.undo}</button></div>}
    {error && <div role="alert">{error} {cards === null && <Button size="sm" variant="outline"
      onClick={() => {setError("");refresh(n => n + 1);}}>{words.retry}</Button>}</div>}
    {cards === null && !error && <p role="status" className="art-empty">{words.loading}</p>}
    <div ref={grid} className="art-grid">{matches.map(a=><article key={a.id} className="art-card" data-id={a.id}>
      <button className="art-cover" disabled={trash} onClick={()=>open(a.id)} aria-label={a.title}><FileCode2/><img key={a.version} data-id={a.id} data-version={a.version} alt=""/></button>
      <div className="art-summary"><button className="art-title" disabled={trash} onClick={()=>open(a.id)}>{a.title}</button><p>{a.description}</p>
      <footer><small>HTML · {words.version} {a.version}</small><div className="art-tools">
        {trash ? <IconButton label={words.restore} onClick={()=>void change("recover",a)}><RotateCcw/></IconButton> : <>
        <IconButton label={a.pinned ? words.unpin : words.pin} pressed={!!a.pinned} onClick={()=>void change("pin",a)}><Pin/></IconButton>
        <IconButton label={words.remove} onClick={()=>confirm(a.id)}><Trash2/></IconButton></>}</div></footer></div>
    </article>)}</div>{cards !== null && !error && matches.length===0 && <p className="art-empty">{query ? words.noResults : trash ? words.emptyTrash : words.empty}</p>}
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
function ShortcutActions({card,finish,report}:{card:Details;finish:(status:string)=>void;report:(status:string)=>void}) {
  const words = getArtifactWords();
  const installer=bridge().chronosArtifactInstaller;
  const [installed,setInstalled]=useState<boolean|null>(null);
  const [busy,setBusy]=useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- query the OS when the user opens the actions menu.
  useEffect(()=>{
    if (!installer) return;
    let active=true;
    void installer.installed(card.id).then(value=>{if(active)setInstalled(value);},error=>{
      if(active){setInstalled(false);report(desktopError(error,words.checkShortcutsFailed));}
    });
    return ()=>{active=false;};
  },[installer,card.id,report]);
  if (!installer) return null;
  async function change(remove:boolean) {
    if (!installer || busy) return;
    setBusy(true);
    try {
      if (remove) await installer.remove(card.id);
      else await install(card);
      finish(remove ? words.shortcutsRemoved : words.installed);
    } catch(error){
      report(desktopError(error,remove ? words.removeShortcutsFailed : words.installFailed));
      setBusy(false);
    }
  }
  return <><button disabled={installed===null || busy} onClick={()=>void change(false)}><Check/>{installed ? words.updateShortcuts : words.install}</button>
    {installed && <button disabled={busy} onClick={()=>void change(true)}><Trash2/>{words.removeShortcuts}</button>}</>;
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
function Viewer({id,back,onClose,container}:{container?:HTMLElement | undefined;id:string;back:()=>void;onClose:()=>void}) {
  const words = getArtifactWords();
  const [details,setDetails]=useState<Details|null>(null);
  const [version,setVersion]=useState(0);
  const [code,setCode]=useState(false);
  const [files,setFiles]=useState<Files|null>(null);
  const [file,setFile]=useState("index.html");
  const [status,setStatus]=useState("");
  const [revision,refresh]=useState(0);
  const [menu,setMenu]=useState(false);
  const root=useRef<HTMLElement>(null);
  const versionSelect=useRef<HTMLButtonElement>(null);
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
      const prompt=`Продолжим работу над артефактом «${details.title}». ${artifactUrl(id)} · ${words.version} ${version}`;
      await router.navigate({to:"/new",search:{prompt}});
    }
    onClose();
  }
  const content = files?.[file];
  return <section ref={root} className="art-shell art-view" data-artifact-view="">
    <header className="art-head"><IconButton label={words.libraryBack} onClick={back}><ArrowLeft/></IconButton>
      <h2>{details?.title ?? words.loading}</h2><div className="art-tools">
        <IconButton label={words.actions} pressed={menu} onClick={()=>setMenu(!menu)}><Ellipsis/></IconButton>
        <IconButton label={words.close} onClick={onClose}><X/></IconButton></div></header>
    {details && <><div className="art-controls"><div className="art-segment">
      <button aria-pressed={!code} onClick={()=>setCode(false)}>{words.preview}</button>
      <button aria-pressed={code} onClick={()=>setCode(true)}><Code2/>{words.code}</button></div>
      <ArtifactSelect container={container} triggerRef={versionSelect} label={words.version} value={String(version)}
        options={details.history.map(v => ({value:String(v.version), label:words.version+" "+v.version+" · "+v.label}))}
        onChange={value => {setFiles(null);setFile("index.html");setVersion(Number(value));}} />
      {version!==details.version && <button onClick={()=>run(async()=>{await request("restore",{id,version,expectedVersion:details.version});versionSelect.current?.focus();refresh(n=>n+1);})}>{words.restore}</button>}
    </div>
    {menu && <div className="art-menu"><button onClick={()=>run(async()=>{const src=(await selectedFiles())[file];if(typeof src==="string") await navigator.clipboard.writeText(src);else if(src) await navigator.clipboard.writeText(src.data);setStatus(words.copied);})}><Copy/>{words.copy}</button>
      <button onClick={()=>run(async()=>download(await selectedFiles(),details.title))}><Download/>{words.download}</button>
      <button onClick={()=>run(()=>request<void>("openWindow",{id,version:version===details.version?undefined:version,theme:readTheme()}))}><ExternalLink/>{words.window}</button>
      <ShortcutActions card={details} report={setStatus} finish={notice=>{
        setMenu(false);setStatus(notice);root.current?.querySelector<HTMLButtonElement>(".art-head [aria-pressed]")?.focus();
      }}/>
    </div>}
    {code ? <div className="art-code">{files && Object.keys(files).length>1 && <ArtifactSelect container={container} label={words.source} value={file}
      options={Object.keys(files).map(name => ({value:name,label:name}))} onChange={setFile} />}
      <pre>{!files ? words.loading : typeof content==="string" ? content : words.binary}</pre></div>
      : <ArtifactView key={version} id={id} historic={version===details.version?null:version}/>}
    <footer className="art-bottom"><small><LockKeyhole/>{words.private}</small><button onClick={()=>run(continueInChat)}>{words.chat}<ArrowUpRight/></button></footer>
    </>}{status && <p role="status" className="art-notice">{status}</p>}</section>;
}
export function Library({url,onClose,navigate,container}:{container?:HTMLElement | undefined;url:string;onClose:()=>void;navigate:(url:string)=>void}) {
  const id=artifactId(url);
  return id ? <Viewer container={container} key={id} id={id} back={()=>navigate(galleryUrl)} onClose={onClose}/> :
    <Gallery container={container} key={url} open={id=>navigate(artifactUrl(id))} onClose={onClose} confirmId={new URL(url).searchParams.get("delete")}/>;
}
let dialog:HTMLDialogElement | null=null, root:Root|null=null;
export function openLibraryDialog(url=galleryUrl) {
  const words = getArtifactWords();
  if(!dialog){
    dialog=document.createElement("dialog");dialog.className="art-dialog";dialog.setAttribute("aria-label",words.library);
    document.body.append(dialog);root=createRoot(dialog);
    dialog.addEventListener("close",()=>{root?.unmount();root=null;dialog?.remove();dialog=null;},{once:true});
    dialog.showModal();
  }
  root?.render(<Library container={dialog ?? undefined} key={url} url={url} navigate={openLibraryDialog} onClose={()=>dialog?.close()}/>);
}

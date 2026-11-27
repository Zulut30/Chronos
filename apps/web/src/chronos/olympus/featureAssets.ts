import { featureIds, featureKey, type FeatureId } from "./featureFlags.ts";

// ESM dependencies may be evaluated before main, or first requested after a settings change.
// Take one synchronous snapshot per window, whichever Olympus entry runs first.
const flags = JSON.stringify(featureIds.map((id) => [id, featureKey(id)]));
const snapshot = `globalThis.__chronosOlympusDisabled ??= (() => {
  const disabled = new Set();
  try {
    for (const [id, key] of ${flags}) {
      if (localStorage.getItem(key) === "0") disabled.add(id);
    }
  } catch {}
  if (disabled.has("22-budget")) disabled.add("26-notifications");
  return disabled;
})();\n`;

const enabled = (id: FeatureId) => `!globalThis.__chronosOlympusDisabled.has("${id}")`;

function guardedBlock(id: FeatureId, source: string) {
  // Upstream's four send/resume paths call the Olympus resolver unconditionally.
  const fallback = id === "10-plan-mode" ? " else { globalThis.__olyPlanMode = fallback => fallback; }" : "";
  return `if (${enabled(id)}) {\n${source}\n}${fallback}\n`;
}

// English structural counterpart for 24-thread-details.js: adds the same data-oly-td hooks,
// compact limits reset/caption spans, and lineage subtitles in native English without rewriting
// T3 copy into Russian or fighting the English DOM translator.
const englishThreadDetails = `;(()=>{try{
if(globalThis.__olyThreadDetails)return;
const CARD='[data-thread-details-card]';
const W={writes:0,passes:0};
const shortLabel=s=>String(s||'');
function dur(ms){
 const m=Math.max(1,Math.floor(ms/60000));if(m<60)return m+' min';
 const h=Math.floor(m/60),mm=m%60;if(h<24)return h+' h'+(h<10&&mm?' '+mm+' min':'');
 const d=Math.floor(h/24),hh=h%24;return d+' d'+(hh?' '+hh+' h':'');
}
function setText(n,v){if(n.nodeValue!==v){n.nodeValue=v;W.writes++}}
function attr(e,k,v){if(e.getAttribute(k)!==v){e.setAttribute(k,v);W.writes++}}
function drop(e,k){if(e.hasAttribute(k)){e.removeAttribute(k);W.writes++}}
function txt(e,v){if(e.textContent!==v){e.textContent=v;W.writes++}}
const ours=e=>typeof e.className==='string'&&e.className.startsWith('oly-td-');
function own(parent,cls){for(const c of parent.children)if(c.className===cls)return c;return null}
function add(parent,cls){const e=document.createElement('span');e.className=cls;e.style.display='none';parent.appendChild(e);W.writes++;return e}
function up(e,tag){while(e&&e.tagName!==tag)e=e.parentElement;return e}
function headsOf(root){
 const heads={},stack=[root];
 while(stack.length){const e=stack.pop();
  for(let c=e.lastChild;c;c=c.previousSibling){
   if(c.nodeType===1&&!ours(c)){
    if(c.tagName==='H3'&&/^thread-details-.+-heading$/.test(c.id))heads[c.id.slice(15,-8)]=c;
    stack.push(c);
   }
  }
 }
 return heads;
}
function fiberProp(el,key){
 const k=Object.keys(el).find(k=>k.startsWith('__reactFiber$'));let f=k?el[k]:null;
 for(let d=0;f&&d<16;d++,f=f.return){const v=f.memoizedProps&&f.memoizedProps[key];if(v&&typeof v==='object')return v}
 return null;
}
function resetIn(row,now){
 const w=fiberProp(row,'window');const t=w&&typeof w.resetsAt==='string'?Date.parse(w.resetsAt):NaN;
 return t>now?dur(t-now):'';
}
function rowAria(cur,reset){
 const m=/^(.+): (\\d+)% left(?:, resets in .+)?$/.exec(cur);
 return m?shortLabel(m[1])+': '+m[2]+'% left'+(reset?', resets in '+reset:''):null;
}
function fullTitle(lab){
 if(lab.scrollWidth>lab.clientWidth+1){attr(lab,'title',lab.textContent);attr(lab,'data-oly-td-title','')}
 else if(lab.hasAttribute('data-oly-td-title')){drop(lab,'title');drop(lab,'data-oly-td-title')}
}
function rows(sec,head){const g=sec.lastElementChild;return g&&g!==head?[...g.children].filter(r=>r.hasAttribute('tabindex')):[]}
function usage(h3,now){
 const sec=up(h3,'SECTION'),head=h3.parentElement;if(!sec||!head)return;
 attr(sec,'data-oly-td','usage');
 if(h3.firstChild&&h3.firstChild.nodeType===3&&h3.firstChild.nodeValue.trim()==='Usage limits')setText(h3.firstChild,'Limits');
 if(sec.getAttribute('aria-label')==='Usage limits')attr(sec,'aria-label','Limits');
 let any=false;const labs=[];
 for(const row of rows(sec,head)){
  const lab=row.firstElementChild;
  if(lab&&lab.tagName==='SPAN')labs.push(lab);
  const r=resetIn(row,now);if(r)any=true;
  let sp=own(row,'oly-td-reset');if(!sp&&r)sp=add(row,'oly-td-reset');if(sp)txt(sp,r);
  const a=row.getAttribute('aria-label'),v=a&&rowAria(a,r);if(v)attr(row,'aria-label',v);
 }
 const cap=own(head,'oly-td-cap')||add(head,'oly-td-cap');txt(cap,any?'reset · remaining':'remaining');
 for(const lab of labs)fullTitle(lab);
}
function context(h3){
 const sec=up(h3,'SECTION');if(sec)attr(sec,'data-oly-td','context');
}
const REL_DOWN={subagent:'Subagent',fork:'Fork','side-chat':'Side chat',sidechat:'Side chat',delegate:'Delegated',delegated:'Delegated'};
const REL_UP={subagent:'Parent agent',fork:'Source thread','side-chat':'Main chat',sidechat:'Main chat',delegate:'Parent thread',delegated:'Parent thread'};
const EDGE_STATE={running:'running',starting:'running',preparing:'running',queued:'queued',waiting:'waiting',completed:'done',succeeded:'done',done:'done',failed:'failed',error:'failed',interrupted:'stopped',cancelled:'stopped',canceled:'stopped',stopped:'stopped'};
function fiberOf(e){const k=Object.keys(e).find(k=>k.startsWith('__reactFiber$'));return k?e[k]:null}
function listRows(ul){for(let f=fiberOf(ul),d=0;f&&d<8;d++,f=f.return){const r=f.memoizedProps&&f.memoizedProps.rows;if(Array.isArray(r))return r}return null}
function modelOf(id){
 const bg=globalThis.__olyBgTasks,sh=bg&&bg.store&&bg.store._shells&&bg.store._shells.get(id);
 let m=sh&&sh.model||'';
 if(!m)try{const core=globalThis.__olyPanels&&globalThis.__olyPanels.core,list=core&&core.ent&&core.ent.u();
  const t=Array.isArray(list)?list.find(t=>t&&t.id===id):null;m=t&&t.modelSelection&&t.modelSelection.model||''}catch(_){}
 return m?(bg&&bg.modelName?bg.modelName(m):m):'';
}
function rowDetail(r){
 const e=r&&r.edge;if(!e)return'';
 const upEdge=e.sourceThreadId===r.threadId,kind=String(e.kind||'');
 return[(upEdge?REL_UP:REL_DOWN)[kind]||'',modelOf(r.threadId),EDGE_STATE[String(e.status||'')]||''].filter(Boolean).join(' · ');
}
function findTag(root,tag){const st=[root];for(let n=0;st.length&&n<400;n++){const e=st.shift();for(const c of e.children){if(c.tagName===tag)return c;st.push(c)}}return null}
const hasCls=(e,a,b)=>{const c=' '+e.className+' ';return c.includes(' '+a+' ')&&c.includes(' '+b+' ')};
function lineageRows(sec){
 const ul=findTag(sec,'UL');if(!ul)return;
 const data=listRows(ul);if(!data)return;
 const byId=new Map();for(const r of data)if(r&&r.threadId)byId.set(r.threadId,r);
 for(const li of ul.children){
  const f=fiberOf(li),r=f&&byId.get(f.key);
  const b=li.firstElementChild&&li.firstElementChild.tagName==='BUTTON'?li.firstElementChild:null;
  let box=null;if(b)for(const c of b.children)if(c.tagName==='SPAN'&&hasCls(c,'min-w-0','flex-1')){box=c;break}
  if(!box)continue;
  const v=r?rowDetail(r):'';let sub=own(box,'oly-td-sub');
  if(!sub&&v){sub=document.createElement('span');sub.className='oly-td-sub';box.appendChild(sub);W.writes++}
  if(sub)txt(sub,v);
 }
}
function lineage(h3){
 const sec=up(h3,'SECTION'),head=h3.parentElement;if(!sec||!head)return;
 attr(sec,'data-oly-td','lineage');
 attr(h3,'title','Parent thread, forks and subagents of this thread');
 const stack=[head];
 while(stack.length){const e=stack.pop();for(const c of e.children){
  if(c.tagName==='BUTTON'&&c.getAttribute('aria-haspopup')==='menu')attr(c,'title','Agent session actions');else stack.push(c);
 }}
 try{lineageRows(sec)}catch(_){}
}
function processCard(card,now){
 const heads=headsOf(card);
 if(heads.usage)usage(heads.usage,now);
 if(heads.context)context(heads.context);
 if(heads.lineage)lineage(heads.lineage);
}
function processPopup(){}
let raf=0;
function flush(){
 raf=0;W.passes++;const now=Date.now();
 if(typeof document==='undefined')return;
 for(const c of document.querySelectorAll(CARD))processCard(c,now);
}
const schedule=()=>{if(!raf&&typeof requestAnimationFrame==='function')raf=requestAnimationFrame(flush)};
const near=n=>{const e=n.nodeType===1?n:n.parentElement;return !!(e&&!ours(e)&&e.closest&&e.closest(CARD))};
const CSS=\`
[data-thread-details-card] [data-oly-td=lineage] ul>li{height:auto;min-height:2rem}
[data-thread-details-card] [data-oly-td=lineage] ul>li>button{height:auto;min-height:2rem;padding-block:5px;white-space:normal}
[data-thread-details-card] [data-oly-td=lineage] ul>li>button span[class~="truncate"]{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;white-space:normal;text-overflow:clip;overflow-wrap:anywhere;line-height:1.3}
[data-thread-details-card] [data-oly-td=lineage] ul:not(:has([data-workflow-expanded])){max-height:min(20rem,45dvh)}
[data-thread-details-card] .oly-td-sub{display:block;margin-top:2px;overflow:hidden;font-size:11px;font-weight:400;line-height:14px;color:var(--muted-foreground);white-space:nowrap;text-overflow:ellipsis}
[data-thread-details-card] .oly-td-sub:empty{display:none}
\`;
const start=()=>{
 try{const st=document.createElement('style');st.id='oly-td-css';st.textContent=CSS;(document.head||document.documentElement).appendChild(st)}catch(_){}
 if(typeof MutationObserver==='function'&&document.body){
  const mo=new MutationObserver(ms=>{
   if(raf)return;
   for(const m of ms){
    if(near(m.target)){schedule();return}
    if(m.type==='childList')for(const a of m.addedNodes)if(a.nodeType===1&&!ours(a)&&(a.matches(CARD)||a.querySelector(CARD))){schedule();return}
   }
  });
  mo.observe(document.body,{subtree:true,childList:true,characterData:true});
 }
 schedule();
 if(typeof setInterval==='function')setInterval(()=>{if(!document.hidden&&document.querySelector(CARD+' [data-oly-td="usage"]'))schedule()},30000);
};
if(typeof document!=='undefined'){document.body?start():typeof addEventListener==='function'&&addEventListener('DOMContentLoaded',start)}
globalThis.__olyThreadDetails={flush,processCard,processPopup,shortLabel,dur,rowAria,rowDetail,stats:W};
}catch(e){console.warn('oly thread-details en',e)}})();`;

export function featureBlock(file: string, source: string) {
  // Extend the shared skip predicate before the byte-pinned Russian translator starts.
  if (file === "05-oly-core.js") return source + `\n;(() => {
    const core = globalThis.__olyCore;
    if (!core) return;
    const makeSkip = core.makeSkip;
    core.makeSkip = selector => makeSkip(selector.includes(".chat-markdown")
      ? selector + ',[translate="no"]:not(html),[data-item-path],[data-file-path]'
      : selector);
  })();\n`;
  // 24-thread-details rewrites the usage card and tooltips into Russian; keep its layout hooks in English.
  if (file === "24-thread-details.js") {
    return 'if (globalThis.__chronosShellLanguage !== "en") {\n' + source + '\n} else {\n' + englishThreadDetails + '\n}\n';
  }
  // The immutable 4774 fix rewrites Waiting/Running and file counts into Russian.
  if (file === "87-ru-fixes.js") return 'if (globalThis.__chronosShellLanguage !== "en") {\n' + source + '\n}\n';
  if (file === "26-notifications.js") return guardedBlock("26-notifications",
    "const Notification = globalThis.__chronosOlympusNotification ?? globalThis.Notification;\n" + source);
  const id = featureIds.find((id) => file === id + ".js");
  return id ? guardedBlock(id, source) : source;
}

export function standaloneFeature(file: string, source: string) {
  if (file === "88-rich-markdown.chat.js") {
    // Both shared markdown entry points already omit their hooks and extra schema when undefined.
    return snapshot + source + `\nexport const richMarkdown = ${enabled("88-rich-text")} ? {pre: __olyRichPre, post: __olyRichPost} : undefined;\n`;
  }
  const block = featureBlock(file, source);
  return block === source ? source : snapshot + block;
}

export function assemblePrologue(imports: string, read: (path: string) => string) {
  return snapshot + imports.trimEnd().split(/\r?\n/).map((line) => {
    if (!line.trim()) return "\n";
    const file = /^import "\.\/features\/([\w.-]+\.js)";$/.exec(line)?.[1];
    if (!file) throw new Error("Unexpected Olympus prologue line: " + line);
    return featureBlock(file, read("./features/" + file));
  }).join("");
}

export const settingsFeatureFiles = ["90-mcp-manager.js", "91-prompts-settings.js", "80-integrations.js"] as const;

// These release modules install observers and global listeners. Bind those resources to the
// settings dialog, keeping the original source intact and outside the compiler and translator.
export function settingsFeatureAsset(read: (path: string) => string) {
  const body = settingsFeatureFiles.map((name) => read("features/" + name)).join("\n");
  return `export function mount({ document, window, globalThis, MutationObserver, addEventListener, requestAnimationFrame }) {\n${body}\n}\n`;
}

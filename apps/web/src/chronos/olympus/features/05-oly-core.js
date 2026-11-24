;(()=>{try{
/* 05-oly-core: shared bus for Olympus client modules. Must be the FIRST module in the bundle;
   every other module checks globalThis.__olyCore?.x and keeps its own fallback.
   - isSkippedSubtree(node): node is inside chat/user content, code, editor, terminal or a form field
     (ancestor answers cached in a WeakMap, so chat streaming tokens are rejected in O(1));
   - onUiMount(fn): one childList observer, fn(elements) once per frame with added non-chat elements;
   - onRoute(fn): history.pushState/replaceState + popstate + hashchange, deduplicated by URL;
   - onWsFrame(fn,opts)/onWsSend(fn,opts): one hook on the app WebSocket, JSON.parse once per text frame
     (opts.contains: string[] - the frame is parsed for this subscriber only if the raw text has one of them). */
if(globalThis.__olyCore&&globalThis.__olyCore.version>=1)return;
const warn=(w,e)=>{try{console.warn('oly core '+w,e)}catch(_){}};
const call=(set,w,...a)=>{for(const f of set)try{f(...a)}catch(e){warn(w,e)}};

/* ---------- 1. subtree predicates (ancestor-or-self matches selector, cached per ancestor) ---------- */
const SKIP_SEL='.chat-markdown,[data-user-message-bubble],pre,code,.font-mono,.composer-tiptap,[contenteditable="true"],textarea,input,select,.xterm';
const CONTENT_SEL='.chat-markdown,[data-user-message-bubble],pre,code,.composer-tiptap,[contenteditable="true"],textarea,input,select,.xterm';
const preds=new Map();
function makeSkip(sel){
 let p=preds.get(sel);if(p)return p;
 const cache=new WeakMap();// Element -> boolean: element or an ancestor matches sel
 const anc=e=>{let x=e,res=false;const chain=[];
  while(x){const c=cache.get(x);if(c!==undefined){res=c;break}if(x.matches(sel)){res=true;cache.set(x,true);break}chain.push(x);x=x.parentElement}
  // a chain that ends outside the document (detached subtree) is not cached: it may still be inserted into chat
  if(res||x||chain[chain.length-1]===document.documentElement)for(const y of chain)cache.set(y,res);
  return res};
 // the node itself is always matched fresh (classes of the node may change); ancestors come from the cache
 p=node=>{if(!node)return false;const e=node.nodeType===1?node:node.parentElement;if(!e)return false;
  try{return e.matches(sel)||(e.parentElement?anc(e.parentElement):false)}catch(_){return false}};
 preds.set(sel,p);return p}
const isSkippedSubtree=makeSkip(SKIP_SEL);
const isContentSubtree=makeSkip(CONTENT_SEL);// same without .font-mono (monospace UI rows stay "UI")

/* ---------- 2. onUiMount: added non-chat elements, batched per frame ---------- */
const uiSubs=new Set();let uiMo=null,uiQ=[],uiRaf=0;
function uiFlush(){uiRaf=0;const q=uiQ;uiQ=[];const out=[];const seen=new Set();
 for(const e of q)if(!seen.has(e)&&e.isConnected){seen.add(e);out.push(e)}
 if(out.length)call(uiSubs,'onUiMount',out)}
function uiStart(){if(uiMo||!document.body)return;
 uiMo=new MutationObserver(ms=>{for(const m of ms){if(!m.addedNodes.length||isSkippedSubtree(m.target))continue;
   for(const n of m.addedNodes)if(n.nodeType===1)uiQ.push(n)}
  if(uiQ.length&&!uiRaf)uiRaf=requestAnimationFrame(uiFlush)});
 uiMo.observe(document.body,{childList:true,subtree:true})}
function onUiMount(fn){if(typeof fn!=='function')return()=>{};uiSubs.add(fn);
 if(document.body)uiStart();else addEventListener('DOMContentLoaded',uiStart,{once:true});
 return()=>{uiSubs.delete(fn)}}

/* ---------- 3. onRoute ---------- */
const routeSubs=new Set();let lastHref=location.href,routeQueued=false;
const NOT_THREAD=['settings','pair','usage','pull-requests'];
function route(){const hash=location.hash||'',path=location.pathname||'/';
 const raw=hash.startsWith('#/')?hash.slice(1):path;
 const parts=raw.split(/[?#]/)[0].split('/').filter(Boolean).map(x=>{try{return decodeURIComponent(x)}catch(_){return x}});
 const draftId=parts[0]==='draft'&&parts[1]?parts[1]:null;
 const threadId=!draftId&&parts.length>=2&&!NOT_THREAD.includes(parts[0])?parts[parts.length-1]:null;
 return{path,hash,threadId,draftId}}
function routeCheck(){routeQueued=false;if(location.href===lastHref)return;lastHref=location.href;if(routeSubs.size)call(routeSubs,'onRoute',route())}
function routeChanged(){if(routeQueued)return;routeQueued=true;queueMicrotask(routeCheck)}
for(const k of['pushState','replaceState']){const o=history[k];if(typeof o!=='function'||o.__olyCore)continue;
 const f=function(...a){const r=o.apply(this,a);routeChanged();return r};f.__olyCore=true;try{history[k]=f}catch(e){warn('history',e)}}
addEventListener('popstate',routeChanged);addEventListener('hashchange',routeChanged);
function onRoute(fn){if(typeof fn!=='function')return()=>{};routeSubs.add(fn);return()=>{routeSubs.delete(fn)}}

/* ---------- 4. WebSocket frames (in: constructor hook, out: prototype.send hook) ---------- */
const inSubs=new Map(),outSubs=new Map();// fn -> contains[]|null
const stats={in:0,inParsed:0,out:0,outParsed:0};
function wants(subs,d){let all=null;
 for(const[f,c]of subs){if(!c||c.some(s=>d.indexOf(s)>=0))(all||(all=[])).push(f)}return all}
function dispatch(subs,d,meta,dir){
 const c=d.charCodeAt(0);if(c!==123&&c!==91)return;// JSON object/array only
 const fs=wants(subs,d);if(!fs)return;let msg;try{msg=JSON.parse(d)}catch(_){return}
 stats[dir+'Parsed']++;for(const f of fs)try{f(msg,meta)}catch(e){warn(dir==='in'?'onWsFrame':'onWsSend',e)}}
function hookIn(ws){if(ws.__olyCoreIn)return;ws.__olyCoreIn=1;let buf='';
 ws.addEventListener('message',e=>{try{let d=e.data;if(typeof d!=='string')return;stats.in++;
  if(!inSubs.size){buf='';return}
  // T3 splits big frames: chunks prefixed with U+001E, the last chunk has no prefix
  if(d.charCodeAt(0)===30){buf+=d.slice(1);if(buf.length>96e6)buf='';return}if(buf){d=buf+d;buf=''}
  dispatch(inSubs,d,{url:ws.url,direction:'in',raw:d,socket:ws},'in')}catch(err){warn('ws in',err)}})}
const NWS=globalThis.WebSocket;
if(NWS&&!NWS.__olyCore){
 const W=function(...a){const ws=new NWS(...a);try{hookIn(ws)}catch(_){}return ws};
 W.prototype=NWS.prototype;for(const k of['CONNECTING','OPEN','CLOSING','CLOSED'])W[k]=NWS[k];
 for(const k of Object.keys(NWS))if(k.startsWith('__oly'))W[k]=NWS[k];
 W.__olyCore=true;globalThis.WebSocket=W;
 const ps=NWS.prototype.send;
 if(typeof ps==='function'&&!ps.__olyCore){const send=function(d){try{if(outSubs.size&&typeof d==='string'){stats.out++;dispatch(outSubs,d,{url:this.url,direction:'out',raw:d,socket:this},'out')}}catch(_){}return ps.call(this,d)};
  send.__olyCore=true;NWS.prototype.send=send}}
const sub=map=>(fn,opts)=>{if(typeof fn!=='function')return()=>{};const c=opts&&Array.isArray(opts.contains)&&opts.contains.length?opts.contains.map(String):null;
 map.set(fn,c);return()=>{map.delete(fn)}};

globalThis.__olyCore={version:1,isSkippedSubtree,isContentSubtree,makeSkip,onUiMount,onRoute,route,onWsFrame:sub(inSubs),onWsSend:sub(outSubs),stats,
 SKIP_SEL,CONTENT_SEL};
}catch(e){console.warn('oly core',e)}})();

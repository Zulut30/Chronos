;(()=>{try{
/* 28-model-account: model picker shows the e-mail of the account behind the selected provider instance.
   Source: provider snapshots the server already sends (auth.email for Claude and Codex), per environment,
   so «Claude» / «Claude 2» on Windows and on SSH servers show their own account. Read-only, DOM add-on only. */
'use strict';
if(globalThis.__olyModelAccount)return;
const MARKERS=['"welcome"','"snapshot"','"providerStatuses"','"providerStatusDeltas"'];
const envs=new Map();// environmentId -> Map(instanceId -> {email,label})
const urlEnv=new Map(),socketEnv=new WeakMap();
const clean=v=>typeof v==='string'?v.trim():'';
// «Claude Ultra Subscription» -> «Claude Ultra», «Cursor account» -> «Cursor»: plan names only, no mixed RU/EN words
const plan=v=>clean(v).replace(/^Подписка\s+/i,'').replace(/\s+(subscription|account|аккаунт)$/i,'').replace(/^Аккаунт\s+/i,'').trim();
function store(env,list,replace){
 if(!env||!Array.isArray(list))return;
 const m=replace?new Map():(envs.get(env)||new Map());
 for(const r of list){if(!r||typeof r.instanceId!=='string')continue;
  const a=r.auth||{};m.set(r.instanceId,{email:clean(a.email),label:plan(a.label)})}
 envs.set(env,m);schedule()}
function ingest(frame,meta={}){
 let url='';try{const u=new URL(meta.url);url=u.origin+u.pathname}catch(_){}
 const visit=o=>{
  if(!o||typeof o!=='object')return;
  if(Array.isArray(o)){for(const x of o)visit(x);return}
  const announced=o.type==='welcome'?o.payload?.environment?.environmentId:o.type==='snapshot'?o.config?.environment?.environmentId:null;
  if(typeof announced==='string'&&announced){urlEnv.set(url,announced);if(meta.socket)socketEnv.set(meta.socket,announced)}
  if(o.version===1&&(o.type==='snapshot'||o.type==='providerStatuses'||o.type==='providerStatusDeltas')){
   const env=(meta.socket&&socketEnv.get(meta.socket))||urlEnv.get(url);
   if(o.type==='snapshot')store(env,o.config?.providers,true);
   else store(env,o.payload?.providers,o.type==='providerStatuses');
   return}
  for(const k of ['values','value','exit','payload','result','data','items'])if(o[k]&&typeof o[k]==='object')visit(o[k])};
 visit(frame)}
if(globalThis.__olyCore?.onWsFrame)globalThis.__olyCore.onWsFrame(ingest,{contains:MARKERS});

/* ---------- picker context: environment from the picker's React props, instance from the sidebar ---------- */
function props(el,test,depth=60){
 const k=Object.keys(el).find(k=>k.startsWith('__reactFiber$'));let f=k?el[k]:null;
 for(let i=0;f&&i<depth;i++,f=f.return){const p=f.memoizedProps;if(p&&typeof p==='object'&&test(p))return p}
 return null}
function context(root){
 const p=props(root,p=>typeof p.environmentId==='string'&&Array.isArray(p.instanceEntries));
 const pressed=root.querySelector('[data-model-picker-sidebar] [aria-pressed="true"]');
 const side=pressed?.closest('[data-model-picker-provider]')?.getAttribute('data-model-picker-provider');
 const inst=side||(root.querySelector('[data-model-picker-sidebar]')?'':clean(p?.activeInstanceId));
 return {env:p?.environmentId||'',inst:inst==='favorites'?'':inst,entries:p?.instanceEntries||[]}}
function account(env,inst){
 if(!inst)return null;
 const own=env&&envs.get(env)?.get(inst);
 if(own)return own.email?own:null;
 if(env&&envs.has(env))return null;
 // environment unknown to this module: only an unambiguous answer
 const all=[...envs.values()].map(m=>m.get(inst)).filter(x=>x&&x.email);
 return all.length&&all.every(x=>x.email.toLowerCase()===all[0].email.toLowerCase())?all[0]:null}

/* ---------- view ---------- */
const STYLE_ID='oly-model-account-style';
function style(){if(document.getElementById(STYLE_ID))return;const s=document.createElement('style');s.id=STYLE_ID;
 s.textContent='.oly-acct{display:flex;align-items:center;gap:6px;min-width:0;margin:6px 0 2px;padding:3px 8px;border-radius:6px;'+
 'font:500 12px/18px Inter,ui-sans-serif,system-ui,sans-serif;color:var(--muted-foreground);background:color-mix(in oklab,var(--muted) 45%,transparent);user-select:text}'+
 '.oly-acct svg{flex:none;width:13px;height:13px;opacity:.8}'+
 '.oly-acct-mail{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--foreground)}'+
 '.oly-acct-plan{flex:none;margin-left:auto;padding-left:8px;white-space:nowrap;opacity:.85}';
 document.head.appendChild(s)}
const ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';
function searchBlock(root){
 // root > model column > search block (shrink-0, holds the bordered search field); the list below is flex-1
 const input=root.querySelector('input[placeholder]');if(!input)return null;
 let w=input;
 while(w.parentElement&&w.parentElement.parentElement&&w.parentElement.parentElement!==root)w=w.parentElement;
 return w!==input&&w.parentElement?.parentElement===root?w:null}
function paintOne(root){
 const {env,inst}=context(root);const acc=account(env,inst);
 const block=searchBlock(root);
 let node=root.querySelector('.oly-acct');
 if(!acc||!block){if(node)node.remove();return}
 style();
 if(!node){node=document.createElement('div');node.className='oly-acct';node.setAttribute('role','note');
  node.innerHTML=ICON+'<span class="oly-acct-mail"></span><span class="oly-acct-plan"></span>'}
 if(node.parentElement!==block||block.lastElementChild!==node)block.appendChild(node);
 const mail=node.querySelector('.oly-acct-mail'),plan=node.querySelector('.oly-acct-plan');
 if(mail.textContent!==acc.email)mail.textContent=acc.email;
 if(plan.textContent!==acc.label)plan.textContent=acc.label;
 const title='Аккаунт: '+acc.email+(acc.label?' · '+acc.label:'');
 if(node.title!==title){node.title=title;node.setAttribute('aria-label',title)}}
const watched=new WeakSet();
function paint(){raf=0;
 for(const root of document.querySelectorAll('[data-model-picker-content]')){
  try{paintOne(root)}catch(e){console.warn('oly model-account',e)}
  if(!watched.has(root)){watched.add(root);// provider switch inside an open picker changes aria-pressed only
   new MutationObserver(schedule).observe(root,{subtree:true,attributes:true,attributeFilter:['aria-pressed']})}}}
let raf=0;function schedule(){if(!raf)raf=requestAnimationFrame(paint)}
if(globalThis.__olyCore?.onUiMount)globalThis.__olyCore.onUiMount(els=>{
 for(const e of els)if(e.closest?.('[data-model-picker-content]')||e.querySelector?.('[data-model-picker-content]')){schedule();return}});
globalThis.__olyModelAccount={envs,refresh:schedule,account};
}catch(e){console.warn('oly model-account',e)}})();

;(()=>{try{
// oly machines: display aliases for T3 environments + "@" machine mentions in the composer.
// T3 has no API to rename a saved environment (labels come from the remote host and are stored
// in the desktop's encrypted connection catalog), so names are display aliases kept in localStorage
// and applied to rendered text.
const KA='oly-machines-aliases',KK='oly-machines-known';
const ls={get(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch{return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}}};
let aliases=ls.get(KA,{});if(!aliases||typeof aliases!=='object')aliases={};
let known=ls.get(KK,[]);if(!Array.isArray(known))known=[];
const OWN='data-oly-machines';
// never touch chat content, code, editors, inputs, or our own nodes
const SKIP='.chat-markdown,[data-user-message-bubble],pre,code,.font-mono,.composer-tiptap,[contenteditable="true"],textarea,input,select,.xterm,['+OWN+']';
const ATTRS=['aria-label','title'];
const CONTENT='.chat-markdown,[data-user-message-bubble],pre,code,.composer-tiptap,[contenteditable="true"],textarea,input,select,.xterm';
const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
let re=null;
function buildRe(){const ks=Object.keys(aliases).filter(k=>aliases[k]&&aliases[k]!==k).sort((a,b)=>b.length-a.length);
  re=ks.length?new RegExp('(?<![\\p{L}\\p{N}_.@-])(?:'+ks.map(esc).join('|')+')(?![\\p{L}\\p{N}_-])','gu'):null}
buildRe();
const swap=s=>re?s.replace(re,m=>aliases[m]??m):s;
// tracking so aliases can be undone / originals recovered
const tNodes=new Map();// Text -> {src,out}
const tAttrs=new Map();// Element -> {attr:{src,out}}
// skip test: chat streaming is rejected in O(1) through 05-oly-core, the rest (incl. own nodes) by closest()
let fastSkip=()=>false,content=e=>!!(e&&e.closest(CONTENT));
const skipEl=e=>fastSkip(e)||!!e.closest(SKIP);
function textNode(n){if(!n.parentElement||skipEl(n.parentElement))return;const v=n.nodeValue;const rec=tNodes.get(n);
  if(rec&&v===rec.out)return;const src=v;if(!re){if(rec)tNodes.delete(n);return}re.lastIndex=0;
  const out=swap(src);if(out!==src){tNodes.set(n,{src,out});n.nodeValue=out}else if(rec)tNodes.delete(n)}
function attrs(e){if(e.hasAttribute('data-oly-keep'))return;for(const a of ATTRS){const v=e.getAttribute(a);if(!v)continue;let m=tAttrs.get(e);const rec=m&&m[a];
  if(rec&&v===rec.out)continue;if(!re){if(rec)delete m[a];continue}const out=swap(v);
  if(out!==v){if(!m)tAttrs.set(e,m={});m[a]={src:v,out};e.setAttribute(a,out)}else if(rec)delete m[a]}}
function walk(r){if(r.nodeType===3){textNode(r);return}if(r.nodeType!==1||skipEl(r))return;attrs(r);
  const w=document.createTreeWalker(r,5,{acceptNode:n=>n.nodeType===1&&n.matches(SKIP)?2:1});let n;while(n=w.nextNode())n.nodeType===3?textNode(n):attrs(n)}
function origText(n){const r=tNodes.get(n);return r&&n.nodeValue===r.out?r.src:n.nodeValue}
function origOf(el){if(!el)return'';let s='';for(const c of el.childNodes)s+=c.nodeType===3?origText(c):(c.nodeType===1&&!c.hasAttribute(OWN)?origOf(c):'');return s}
function resetAll(){for(const[n,r]of tNodes)if(n.isConnected&&n.nodeValue===r.out)n.nodeValue=r.src;tNodes.clear();
  for(const[e,m]of tAttrs)if(e.isConnected)for(const a in m)if(e.getAttribute(a)===m[a].out)e.setAttribute(a,m[a].src);tAttrs.clear();
  buildRe();if(document.body)walk(document.body)}
function setAlias(orig,alias){alias=(alias||'').trim().slice(0,80);if(!alias||alias===orig)delete aliases[orig];else aliases[orig]=alias;ls.set(KA,aliases);resetAll();schedule()}
const nameOf=o=>aliases[o]||o;

// ---------- known machines (scraped from Settings -> Environments and the Device panel) ----------
function kindOf(sub){if(/^SSH\s/i.test(sub))return'ssh';if(/^(This machine|This device|Эта машина|Этот компьютер|Это устройство)$/i.test(sub))return'local';return't3'}
function saveKnown(){ls.set(KK,known.slice(0,60))}
function upsert(m){const i=known.findIndex(k=>k.name===m.name&&k.type===m.type);if(i>=0){const k=known[i];if(k.sub===m.sub&&k.kind===m.kind)return false;known[i]={...k,...m}}else known.push(m);return true}


// Read metadata through the desktop API; never persist credentials from its catalog.
let discovery=null,lastDiscovery=0;
async function discover(){
 if(discovery)return discovery;if(Date.now()-lastDiscovery<30000)return;
 lastDiscovery=Date.now();discovery=(async()=>{const bridge=window.desktopBridge;if(!bridge)return;
  let changed=false;
  function visit(x,mode,depth=0){if(!x||depth>7)return;
   if(Array.isArray(x)){for(const v of x)visit(v,mode,depth+1);return}
   if(typeof x==='string'){if(mode==='catalog'){try{visit(JSON.parse(x),mode,depth+1)}catch{}}else if(mode==='ssh'&&x.length<160&&!/[\r\n]/.test(x))changed=upsert({type:'env',name:x,sub:'SSH '+x,kind:'ssh'})||changed;return}
   if(typeof x!=='object')return;
   const target=x.target||x.connection||x;const rawName=x.name||x.label||x.displayName||x.alias||target.alias||target.hostAlias||target.host;
   const name=typeof rawName==='string'?rawName.slice(0,160):'';
   const host=target.hostname||target.host||target.hostAlias||target.alias;
   const kind=String(target.kind||target.type||x.kind||'');
   if(name&&(mode==='ssh'||/ssh/i.test(kind)||host)){
    const user=typeof target.username==='string'?target.username:typeof target.user==='string'?target.user:'';
    const dest=typeof host==='string'?host:name;const port=Number(target.port);
    changed=upsert({type:'env',name,sub:'SSH '+(user?user+'@':'')+dest+(port&&port!==22?':'+port:''),kind:'ssh'})||changed;
   }else if(name&&/local|embedded/i.test(kind))changed=upsert({type:'env',name,sub:'Этот компьютер',kind:'local'})||changed;
   for(const k of ['entries','environments','connections','hosts','items','catalog','sshHosts'])if(x[k])visit(x[k],mode,depth+1);
  }
  for(const [method,mode]of [['getConnectionCatalog','catalog'],['discoverSshHosts','ssh']]){
   try{if(typeof bridge[method]==='function')visit(await bridge[method](),mode)}catch{}
  }
  if(changed){saveKnown();schedule()}
 })().finally(()=>{discovery=null});return discovery;
}

// ---------- Settings rows: pencil button + inline rename ----------
const MORE=/^(More actions for |Другие действия: |Другие действия для этой машины|More actions for this machine)/;
const ICON_PENCIL='<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/><path d="m15 5 4 4"/></svg>';
function envRows(){const out=[];for(const b of document.querySelectorAll('button[aria-label]')){const al=b.getAttribute('aria-label');
  const src=(tAttrs.get(b)?.['aria-label']?.out===al)?tAttrs.get(b)['aria-label'].src:al;if(!MORE.test(src))continue;
  const row=b.closest('div.grid');if(!row)continue;const label=row.querySelector('p.truncate.text-sm.font-medium');if(!label)continue;
  out.push({row,btn:b,label,sub:label.nextElementSibling})}return out}
let connSince=0;
function scanSettings(){const rows=envRows();const onConn=/\/settings\/connections/.test(location.pathname);
  if(onConn){if(!connSince)connSince=Date.now()}else connSince=0;
  let changed=false;const seen=[];
  for(const r of rows){const name=origOf(r.label).trim();if(!name)continue;const sub=(r.sub?r.sub.textContent:'').trim();
    const m={type:'env',name,sub,kind:kindOf(sub)};seen.push(m);if(upsert(m))changed=true;
    {const t=aliases[name]?('Исходное имя: '+name):'';if((r.label.getAttribute('title')||'')!==t){r.label.setAttribute('data-oly-keep','');t?r.label.setAttribute('title',t):r.label.removeAttribute('title')}}
    if(!r.row.querySelector('['+OWN+'=rename]'))addPencil(r)}
  // on the Environments page the visible list is authoritative: forget removed environments
  if(onConn&&Date.now()-connSince>2500&&seen.length){const keep=known.filter(k=>k.type!=='env'||seen.some(s=>s.name===k.name));if(keep.length!==known.length){known=keep;changed=true}}
  if(changed)saveKnown()}
function addPencil(r){const b=document.createElement('button');b.type='button';b.setAttribute(OWN,'rename');b.className='oly-mach-pencil';
  b.title='Переименовать';b.setAttribute('aria-label','Переименовать');b.innerHTML=ICON_PENCIL;
  b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();startEdit(r)});
  const host=r.btn.parentElement;host.insertBefore(b,r.btn)}
function startEdit(r){const row=r.row;if(row.querySelector('['+OWN+'=edit]'))return;const name=origOf(r.label).trim();
  const wrap=document.createElement('div');wrap.setAttribute(OWN,'edit');wrap.className='oly-mach-edit';
  const inp=document.createElement('input');inp.className='oly-mach-input';inp.value=aliases[name]||'';inp.placeholder=name;inp.maxLength=80;
  inp.setAttribute('aria-label','Новое имя для '+name);inp.spellcheck=false;
  const ok=document.createElement('button');ok.type='button';ok.className='oly-mach-btn oly-mach-primary';ok.textContent='Сохранить';
  const cancel=document.createElement('button');cancel.type='button';cancel.className='oly-mach-btn';cancel.textContent='Отмена';
  const reset=document.createElement('button');reset.type='button';reset.className='oly-mach-btn oly-mach-ghost';reset.textContent='Исходное имя';reset.title='Вернуть «'+name+'»';
  wrap.append(inp,ok,cancel);if(aliases[name])wrap.append(reset);
  const hint=document.createElement('div');hint.className='oly-mach-hint';hint.textContent='Исходное: '+name+' · имя видно только в этом приложении';wrap.append(hint);
  r.label.style.display='none';r.label.insertAdjacentElement('afterend',wrap);inp.focus();inp.select();
  let done=false;const close=(save,val)=>{if(done)return;done=true;const pen=row.querySelector('['+OWN+'=rename]');wrap.remove();r.label.style.display='';if(save)setAlias(name,val);if(pen&&pen.isConnected)pen.focus({preventScroll:true})};
  ok.addEventListener('mousedown',e=>e.preventDefault());cancel.addEventListener('mousedown',e=>e.preventDefault());reset.addEventListener('mousedown',e=>e.preventDefault());
  ok.addEventListener('click',()=>close(true,inp.value));cancel.addEventListener('click',()=>close(false));reset.addEventListener('click',()=>close(true,''));
  inp.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Enter'){e.preventDefault();close(true,inp.value)}else if(e.key==='Escape'){e.preventDefault();close(false)}});
  inp.addEventListener('blur',()=>setTimeout(()=>{if(!done&&!wrap.contains(document.activeElement))close(true,inp.value)},120))}

// ---------- Device panel: remember simulators/emulators ----------
const DEV_STATE=/·\s*(Running|Stopped|Выполняется|Остановлено|Запущено)\s*$/;
function scanDevices(){let changed=false;for(const s of document.querySelectorAll('span.truncate.text-xs.text-muted-foreground')){
  const t=s.textContent.trim();if(!DEV_STATE.test(t))continue;const n=s.previousElementSibling;if(!n)continue;const name=origOf(n).trim();if(!name)continue;
  const sec=s.closest('[class]')?.parentElement?.closest('div')?.textContent||'';const plat=/android/i.test(name+sec)?'Android':/ios|iphone|ipad/i.test(name+sec)?'iOS':'';
  if(upsert({type:'device',name,sub:t.replace(DEV_STATE,'').trim(),kind:'device',platform:plat}))changed=true}
  if(changed)saveKnown()}

// ---------- "@" mentions in the composer ----------
const ICONS={
  local:'<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/>',
  ssh:'<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 6h.01M6 18h.01"/>',
  t3:'<path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"/>',
  device:'<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>'};
const svg=k=>'<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">'+(ICONS[k]||ICONS.t3)+'</svg>';
function machines(){const list=known.slice();if(!list.some(k=>k.kind==='local'))list.unshift({type:'env',name:'Этот ПК',sub:'Этот компьютер',kind:'local',synthetic:true});
  return list.sort((a,b)=>(a.type===b.type?0:a.type==='env'?-1:1))}
function sshCmd(sub){const t=sub.replace(/^SSH\s+/i,'').trim();const m=/^(.*?):(\d+)$/.exec(t);return m?'ssh -p '+m[2]+' '+m[1]:'ssh '+t}
function reference(m){const shown=nameOf(m.name);const tag=m.type==='device'?'устройство':'машина';
 const details=m.kind==='local'?'этот компьютер, локально':m.kind==='ssh'?m.sub+'; подключение: '+sshCmd(m.sub):(m.platform||'окружение T3')+'; '+(m.sub||'');
 return '@'+tag+':«'+shown+'» ['+details.replace(/[\[\]\r\n]/g,' ')+']';}
function atQuery(){const t=globalThis.__olyReferences?.trigger();return t?{...t,q:t.raw}:null}
const KW={local:'этот пк компьютер локально local machine',ssh:'сервер server ssh машина',t3:'окружение environment машина lan',device:'устройство device телефон phone эмулятор симулятор'};
const norm=s=>(s||'').toLowerCase().replace(/ё/g,'е');
function matchList(q){const qq=norm(q);const all=machines();
  const hit=all.filter(m=>!qq||[nameOf(m.name),m.name,m.sub,m.platform,KW[m.kind]||''].some(s=>norm(s).includes(qq)));
  return hit.slice(0,9)}
let panel=null,cur=null,curItems=[],machineActive=0;
function insert(m){const t=globalThis.__olyReferences?.trigger();if(!t)return;
 globalThis.__olyReferences.insert(t,'machine',m.name,nameOf(m.name),reference(m));hidePanel();}
function hidePanel(){if(panel){panel.remove();panel=null}cur=null;curItems=[]}
function renderPanel(drawer,items){if(!panel){panel=document.createElement('div');panel.setAttribute(OWN,'mention');panel.className='oly-mach-mention';
    panel.addEventListener('mousedown',e=>e.preventDefault())}
  const sig=items.map(m=>m.type+m.name+nameOf(m.name)).join('|');
  if(panel.dataset.sig!==sig){panel.dataset.sig=sig;machineActive=0;panel.textContent='';
    const h=document.createElement('div');h.className='oly-mach-head';h.innerHTML='<span>Машины и устройства</span><span class="oly-mach-keys">клик или Alt+цифра</span>';panel.append(h);
    items.forEach((m,i)=>{const it=document.createElement('div');it.className='oly-mach-item';it.setAttribute('role','option');it.dataset.machineIndex=i;it.setAttribute('aria-selected',String(i===machineActive));
      const ic=document.createElement('span');ic.className='oly-mach-ic';ic.innerHTML=svg(m.kind);
      const nm=document.createElement('span');nm.className='oly-mach-name';nm.textContent=nameOf(m.name);
      const sb=document.createElement('span');sb.className='oly-mach-sub';sb.textContent=(nameOf(m.name)!==m.name?m.name+' · ':'')+(m.type==='device'?(m.platform?m.platform+' · ':'')+m.sub:m.sub);
      const k=document.createElement('span');k.className='oly-mach-key';k.textContent='Alt+'+(i+1);
      it.append(ic,nm,sb,k);it.addEventListener('click',()=>insert(m));panel.append(it)})}
  if(!items.length&&!panel.querySelector('.oly-mach-empty')){const empty=document.createElement('div');empty.className='oly-mach-empty';empty.textContent='Серверов по этому запросу нет';empty.style.padding='12px 8px';panel.append(empty)}
  if(panel.parentElement!==drawer||drawer.firstChild!==panel)drawer.insertBefore(panel,drawer.firstChild)}
function updateMention(){const drawer=document.querySelector('[data-composer-command-drawer]');const q=drawer&&atQuery();
  if(!q||globalThis.__olyMentions?.category!=='machines'){hidePanel();return}discover();
  // T3 lists linked environments natively (type `environment`, description Machine); don't duplicate those
  let nat='';for(const it of drawer.querySelectorAll('[data-slot=command-item]'))if(!it.closest('['+OWN+']')&&/(Machine|Машина)\s*$/.test(it.textContent))nat+='\n'+origOf(it);
  const items=matchList(q.q);cur=q;curItems=items;renderPanel(drawer,items)}
document.addEventListener('keydown',e=>{
 if(!panel||globalThis.__olyMentions?.category!=='machines'||!atQuery()||e.isComposing||e.altKey||e.ctrlKey||e.metaKey)return;
 if(e.key==='ArrowDown')machineActive=(machineActive+1)%Math.max(1,curItems.length);
 else if(e.key==='ArrowUp')machineActive=(machineActive+Math.max(1,curItems.length)-1)%Math.max(1,curItems.length);
 else if((e.key==='Enter'&&!e.shiftKey)||e.key==='Tab'){if(!curItems[machineActive])return;insert(curItems[machineActive])}
 else return;
 e.preventDefault();e.stopImmediatePropagation();panel?.querySelectorAll('[data-machine-index]').forEach(row=>row.setAttribute('aria-selected',String(+row.dataset.machineIndex===machineActive)));
 panel?.querySelector('[aria-selected=true]')?.scrollIntoView({block:'nearest'});
},true);
addEventListener('keydown',e=>{if(!panel||globalThis.__olyMentions?.category!=='machines'||!e.altKey||e.ctrlKey||e.metaKey)return;const d=/^Digit([1-9])$/.exec(e.code);if(!d)return;
  const m=curItems[+d[1]-1];if(!m)return;e.preventDefault();e.stopPropagation();insert(m)},true);
document.addEventListener('selectionchange',()=>schedule());


const CSS=`.oly-mach-pencil{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border:0;border-radius:var(--control-radius,6px);background:transparent;color:var(--muted-foreground);cursor:pointer;opacity:.75}
.oly-mach-pencil:hover{background:var(--accent);color:var(--foreground);opacity:1}
.oly-mach-pencil svg{width:14px;height:14px}
.oly-mach-edit{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:1px 0 3px}
.oly-mach-input{flex:1 1 180px;min-width:120px;height:28px;padding:0 8px;font:inherit;font-size:13px;color:var(--foreground);background:var(--background);border:1px solid var(--border);border-radius:var(--control-radius,6px);outline:none}
.oly-mach-input:focus{border-color:var(--primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--primary) 22%,transparent)}
.oly-mach-btn{height:28px;padding:0 10px;font:inherit;font-size:13px;color:var(--foreground);background:transparent;border:1px solid var(--border);border-radius:var(--control-radius,6px);cursor:pointer;white-space:nowrap}
.oly-mach-btn:hover{background:var(--accent)}
.oly-mach-primary{background:var(--primary);color:var(--primary-foreground);border-color:var(--primary)}
.oly-mach-primary:hover{background:var(--primary);filter:brightness(1.08)}
.oly-mach-ghost{border-color:transparent;color:var(--muted-foreground)}
.oly-mach-hint{flex-basis:100%;font-size:11.5px;color:var(--muted-foreground)}
.oly-mach-mention{padding:6px 6px 4px;border-bottom:1px solid var(--border);font-size:13px}
.oly-mach-head{display:flex;justify-content:space-between;align-items:center;padding:2px 8px 4px;font-size:11.5px;font-weight:500;color:var(--muted-foreground)}
.oly-mach-keys{font-weight:400;opacity:.8}
.oly-mach-item{display:flex;align-items:center;gap:8px;min-height:28px;padding:3px 8px;border-radius:var(--control-radius,6px);cursor:pointer;color:var(--foreground)}
.oly-mach-item[aria-selected=true],.oly-mach-item:hover{background:var(--accent)}
.oly-mach-ic{display:inline-flex;color:var(--muted-foreground);flex:none}
.oly-mach-name{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:40%}
.oly-mach-sub{flex:1;min-width:0;color:var(--muted-foreground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.oly-mach-key{flex:none;font-size:11px;color:var(--muted-foreground);opacity:.75}`;
function addStyle(){if(document.getElementById('oly-machines-style'))return;const st=document.createElement('style');st.id='oly-machines-style';st.setAttribute(OWN,'');st.textContent=CSS;(document.head||document.documentElement).append(st)}
// ---------- observer ----------
let raf=0;function schedule(){if(raf)return;raf=requestAnimationFrame(()=>{raf=0;try{scanSettings();scanDevices();updateMention()}catch(e){console.warn('oly machines',e)}})}
// without aliases (re===null) nothing is rewritten: no text walk at all, only the scans, and those
// are not woken by chat/code/terminal streaming (typing in the composer is covered by selectionchange)
const mo=new MutationObserver(ms=>{let ui=false;for(const m of ms){const t=m.target;const p=t.nodeType===1?t:t.parentElement;
  if(!ui&&!content(p))ui=true;if(!re)continue;
  if(m.type==='characterData')textNode(t);else if(m.type==='attributes'){if(!skipEl(t))attrs(t)}else if(!fastSkip(t))for(const n of m.addedNodes)walk(n)}
  if(ui)schedule()});
const start=()=>{const core=globalThis.__olyCore;if(core&&typeof core.isSkippedSubtree==='function'){fastSkip=core.isSkippedSubtree;if(typeof core.isContentSubtree==='function')content=core.isContentSubtree}discover();addStyle();walk(document.body);mo.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:ATTRS});schedule()};
document.body?start():addEventListener('DOMContentLoaded',start);
globalThis.__olyMachines={get aliases(){return{...aliases}},get known(){return machines()},setAlias,reference,reload:discover};
}catch(e){console.warn('oly machines',e)}})();

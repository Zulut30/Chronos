;(()=>{try{
/* Olympus: chat panels.
   - Any chat from the left menu opens in T3's own right panel (native "side-chat" surface): drag a chat out of the sidebar onto
     the chat area (zones «Открыть здесь» / «Открыть справа» / «Вкладкой в панели» / «Рядом — вторая колонка»), Alt+click,
     middle click, context menu «Открыть справа» / «две колонки».
     The native sidebar drags chats with its own pointer sensor (it cancels HTML5 dragstart): the zones are native
     thread-context drop targets ([data-thread-context-drop] + 't3-thread-context-drop'), HTML5 drag stays as a fallback.
   - The right panel can show two chats side by side (host component used by the _chat chunk patch).
   - «Панель следует за чатом»: chats in the right panel stay when the main chat changes; opening a chat that is in the
     panel swaps it with the main one.
   - The side-chat surface renders a thread in the environment of the main chat: chats of other projects work,
     chats of another environment open in the main window (with a message). */
if(globalThis.__olyPanels)return;
const ASSETS=(()=>{try{const sc=[...document.querySelectorAll('script[type=module][src]')].find(x=>/\/assets\/[^/]+\.js(\?|$)/.test(x.src));if(sc)return new URL('.',sc.src).href}catch{}return location.origin+'/assets/'})();
const CH={ent:'entities-BYt4Kx9w.js',rp:'rightPanelStore-BKC7Sf3u.js',re:'react-BP46yLMB.js',jx:'jsx-runtime-BQExFN_X.js'};
const LS=(k,v)=>{try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v)}catch{}return null};
const loadJ=(k,d)=>{try{const v=JSON.parse(LS(k)||'null');return v&&typeof v==='object'&&!Array.isArray(v)?{...d,...v}:d}catch{return d}};
const P=loadJ('oly-panels-v1',{follow:true,split:{},ratio:{}});
if(!P.split||typeof P.split!=='object')P.split={};if(!P.ratio||typeof P.ratio!=='object')P.ratio={};
const saveP=()=>LS('oly-panels-v1',JSON.stringify(P));
const svg=p=>'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+p+'</svg>';
const I={
 cols:'<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/>',
 side:'<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>',
 main:'<path d="M7 17V7h10"/><path d="M17 17 7 7"/>',
 link:'<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><path d="M8 12h8"/>'};

/* ---------------- core access ---------------- */
let M=null;const subs=new Set();const bump=()=>{for(const f of subs){try{f()}catch{}}};
const RT=()=>globalThis.__TSR_ROUTER__;
const kOf=r=>r.environmentId+':'+r.threadId;
function parseKey(k){if(!k)return null;const i=k.indexOf(':');return i>0?{environmentId:k.slice(0,i),threadId:k.slice(i+1)}:null}
function curRef(){try{const m=RT()?.state?.matches;const p=(m&&m[m.length-1]?.params)||{};return p.environmentId&&p.threadId?{environmentId:p.environmentId,threadId:p.threadId}:null}catch{return null}}
const threads=()=>{try{return M?.ent.u()||[]}catch{return[]}};
const threadBy=(env,id)=>threads().find(t=>t.environmentId===env&&t.id===id)||null;
const panel=()=>M?.rp.getState();
function go(ref){try{RT().navigate({to:'/$environmentId/$threadId',params:{environmentId:ref.environmentId,threadId:ref.threadId}})}catch(e){console.warn('oly panels nav',e)}}

/* ---------------- toast ---------------- */
function toast(msg){let el=document.querySelector('.oly-pn-toast');if(!el){el=document.createElement('div');el.className='oly-pn-toast';el.setAttribute('role','status');el.setAttribute('aria-live','polite');document.body.appendChild(el)}
 el.textContent=msg;el.classList.add('on');clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove('on'),2800)}

/* ---------------- right panel: open beside, split, follow ---------------- */
const isChat=s=>s&&s.kind==='side-chat';
function openBeside(ref,mode){if(!ref)return;if(!M){toast('Панели ещё загружаются');return}
 const cur=curRef();
 if(!cur){go(ref);return}
 if(cur.environmentId!==ref.environmentId){toast('Правая панель показывает чаты только своего окружения — чат открыт в основном окне');go(ref);return}
 if(cur.threadId===ref.threadId){toast('Этот чат уже открыт в основном окне');return}
 const key=kOf(cur),sid='side-chat:'+ref.threadId,st=panel().byThreadKey[key];
 const prevActive=st&&st.isOpen?st.activeSurfaceId:null;
 panel().openSideChat(cur,ref.threadId);
 if(mode==='split'){
  const after=panel().byThreadKey[key];
  if(prevActive&&prevActive!==sid&&after?.surfaces?.some(s=>s.id===prevActive)){panel().activateSurface(cur,prevActive);P.split[key]=sid}
  else{const other=(after?.surfaces||[]).filter(s=>isChat(s)&&s.id!==sid).pop();if(other)P.split[key]=other.id;else toast('Вторая колонка появится, когда в панели будет ещё один чат')}
  saveP();bump();widthHint()}
 else if(P.split[key]===sid){delete P.split[key];saveP();bump()}
 panel().show(cur)}
function widthHint(){setTimeout(()=>{try{if(sessionStorage.getItem('oly-panels-hint'))return;const p=document.querySelector('main[data-slot=sidebar-inset] [data-oly-split=on]');if(!p||p.getBoundingClientRect().width>=720)return;
 sessionStorage.setItem('oly-panels-hint','1');toast('Колонкам тесно: потяните левый край панели или разверните её кнопкой ⤢')}catch{}},600)}
function toggleSplit(){const cur=curRef();if(!cur||!M)return;const key=kOf(cur);
 if(P.split[key]){delete P.split[key];saveP();bump();syncTabbar();return}
 const st=panel().byThreadKey[key];const list=st?.surfaces||[];const i=list.findIndex(s=>s.id===st?.activeSurfaceId);
 const cands=list.filter(s=>isChat(s)&&s.id!==st?.activeSurfaceId);
 if(!cands.length){toast('Нужен ещё один чат: перетащите его из левой панели в правую половину');return}
 const next=list.slice(i+1).find(s=>isChat(s)&&s.id!==st.activeSurfaceId)||cands[0];P.split[key]=next.id;saveP();bump();syncTabbar();widthHint()}
function toggleFollow(){P.follow=!P.follow;saveP();syncTabbar();toast(P.follow?'Чаты в панели остаются при смене основного чата':'У каждого чата своя правая панель')}
let lastMain=null;
function cleanSelf(cur){const st=panel().byThreadKey[kOf(cur)],sid='side-chat:'+cur.threadId;if(st?.surfaces?.some(s=>s.id===sid))panel().closeSurface(cur,sid)}
function onRoute(){if(!M)return;const cur=curRef();if(!cur)return;const key=kOf(cur);
 if(lastMain&&kOf(lastMain)===key)return;const prev=lastMain;lastMain=cur;
 try{
  if(!P.follow||!prev||prev.environmentId!==cur.environmentId){cleanSelf(cur);return}
  const pst=panel().byThreadKey[kOf(prev)];if(!pst||!pst.isOpen){cleanSelf(cur);return}
  const chats=pst.surfaces.filter(isChat);if(!chats.length){cleanSelf(cur);return}
  const map=id=>id===cur.threadId?prev.threadId:id;
  const own=panel().byThreadKey[key];const ownActive=own?.isOpen?own.activeSurfaceId:null;
  for(const s of chats){const tid=map(s.threadId);const t=threadBy(cur.environmentId,tid);if(tid!==cur.threadId&&t&&!t.archivedAt&&!t.deletedAt)panel().openSideChat(cur,tid)}
  cleanSelf(cur);
  const actS=pst.surfaces.find(s=>s.id===pst.activeSurfaceId);
  const target=isChat(actS)?'side-chat:'+map(actS.threadId):(ownActive||'side-chat:'+map(chats[0].threadId));
  panel().activateSurface(cur,target);panel().show(cur);
  const ps=pst.surfaces.find(s=>s.id===P.split[kOf(prev)]);
  if(isChat(ps)){const sid='side-chat:'+map(ps.threadId);if(sid!==target){P.split[key]=sid;saveP()}}
  bump()}catch(e){console.warn('oly panels follow',e)}}

/* split host used by the patched _chat chunk: renders the active surface and (optionally) a second chat surface */
function defineHost(){const R=M.React,J=M.jsx;
 function startGutter(e,key){const g=e.currentTarget,wrap=g.parentElement,a=wrap.firstElementChild;if(!a)return;e.preventDefault();g.setPointerCapture?.(e.pointerId);wrap.classList.add('resizing');
  const move=ev=>{const r=wrap.getBoundingClientRect();const v=Math.min(.8,Math.max(.2,(ev.clientX-r.left)/r.width));a.style.flexBasis=(v*100)+'%';P.ratio[key]=Math.round(v*1000)/1000};
  const up=()=>{g.removeEventListener('pointermove',move);g.removeEventListener('pointerup',up);g.removeEventListener('pointercancel',up);wrap.classList.remove('resizing');saveP()};
  g.addEventListener('pointermove',move);g.addEventListener('pointerup',up);g.addEventListener('pointercancel',up)}
 function onGutterKey(e,key){if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;e.preventDefault();const v=Math.min(.8,Math.max(.2,(P.ratio[key]||.5)+(e.key==='ArrowLeft'?-.05:.05)));P.ratio[key]=v;saveP();bump()}
 function OlyPanelHost(p){const{__hj:Hj,__surfaces:all,...props}=p;const[,force]=R.useReducer(x=>x+1,0);
  R.useEffect(()=>{subs.add(force);return()=>{subs.delete(force)}},[]);
  const key=props.threadRef?kOf(props.threadRef):'',sid=P.split[key],a=props.surface;
  const sec=sid&&a&&sid!==a.id?(all||[]).find(s=>s.id===sid&&isChat(s))||null:null;
  const ratio=Math.min(.8,Math.max(.2,P.ratio[key]||.5));
  return J.jsxs('div',{className:'oly-psplit','data-oly-split':sec?'on':'off',children:[
   J.jsx('div',{className:'oly-psplit-cell','data-cell':'a',style:sec?{flexBasis:(ratio*100)+'%'}:undefined,children:J.jsx(Hj,props)},'a'),
   sec?J.jsx('div',{className:'oly-psplit-gutter',role:'separator',tabIndex:0,'aria-orientation':'vertical','aria-label':'Ширина колонок','aria-valuenow':Math.round(ratio*100),onPointerDown:e=>startGutter(e,key),onKeyDown:e=>onGutterKey(e,key)},'g'):null,
   sec?J.jsx('div',{className:'oly-psplit-cell','data-cell':'b',children:J.jsx(Hj,{...props,surface:sec})},'b:'+sec.id):null]})}
 globalThis.__olyPanelHost=OlyPanelHost}

/* ---------------- drag & drop of chats ----------------
   T3's sidebar drags chats with its own pointer sensor (Sidebar.pointer): on pointerdown it adds a document 'dragstart'
   listener that calls preventDefault, so an HTML5 drag never starts for native rows (no drop, no dragend). Outside the
   sidebar the sensor runs a "thread context" drag and, on release, dispatches 't3-thread-context-drop'
   (detail [{environmentId,threadId}]) to the [data-thread-context-drop] element under the pointer (the composer uses it to
   attach a chat as context). Our zones are such targets too; they stop above the composer so that native drop keeps working.
   We follow the pointer ourselves (pointerdown on a row -> pointer enters the chat area -> zones; pointerup -> action after
   the native handler has run). An HTML5 drag (no native sensor, e.g. a connection without orchestration:operate) still works. */
const DT='application/x-oly-thread',ROW='[data-thread-item] > [data-sidebar-row]',CTX_DROP='t3-thread-context-drop';
let drag=null,zonesEl=null,pd=null;
function refFromEl(el){const li=el?.closest?.('[data-thread-item]');return li?parseKey(li.getAttribute('data-thread-item')):null}
function ghost(title){let g=document.querySelector('.oly-pn-ghost');if(!g){g=document.createElement('div');g.className='oly-pn-ghost';document.body.appendChild(g)}g.textContent=title;return g}
function hideZones(){zonesEl?.remove();zonesEl=null}
function endDrag(){drag=null;pd=null;hideZones()}
function dropAct(act,r,via){if(!r)return;const cur=curRef();if(globalThis.__olyPanels)globalThis.__olyPanels.lastDrop={act,ref:r,via,t:Date.now()};
 if(act==='here'){if(!cur||kOf(cur)!==kOf(r))go(r);else toast('Этот чат уже открыт в основном окне')}else openBeside(r,act)}
function composerTop(ir){let top=ir.bottom;for(const f of document.querySelectorAll('main[data-slot=sidebar-inset] [data-thread-context-drop]')){if(f.closest('[data-workspace-area=panel],[data-oly-zones]'))continue;
 const r=f.getBoundingClientRect();if(r.width>80&&r.height>20&&r.top>ir.top+160&&r.top<top)top=r.top}return top}
function showZones(){hideZones();if(!drag)return;const inset=document.querySelector('main[data-slot=sidebar-inset]');if(!inset)return;
 const ib=inset.getBoundingClientRect(),cur=curRef(),ref=drag.ref,zones=[];
 // never cover the sidebar (offcanvas/mobile sidebars overlay the chat area)
 const L=Math.min(ib.right,Math.max(ib.left,drag.sbRight||0)),ir={left:L,top:ib.top,right:ib.right,bottom:ib.bottom,width:ib.right-L,height:ib.height};
 const pnl=[...document.querySelectorAll('main[data-slot=sidebar-inset] [data-workspace-area=panel]')].find(p=>p.getBoundingClientRect().width>60);
 const pr=pnl?.getBoundingClientRect(),ch=Math.max(120,composerTop(ir)-8-ir.top);
 const same=cur&&kOf(cur)===kOf(ref),otherEnv=cur&&cur.environmentId!==ref.environmentId;
 if(!cur||same||otherEnv)zones.push({x:ir.left,y:ir.top,w:(pr?pr.left:ir.right)-ir.left,h:ch,act:'here',label:same?'Этот чат уже открыт':otherEnv?'Открыть здесь (другое окружение)':'Открыть здесь'});
 else if(pr){zones.push({x:ir.left,y:ir.top,w:pr.left-ir.left,h:ch,act:'here',label:'Открыть здесь'});
  zones.push({x:pr.left,y:pr.top,w:pr.width/2,h:pr.height,act:'tab',label:'Вкладкой в панели'});
  zones.push({x:pr.left+pr.width/2,y:pr.top,w:pr.width/2,h:pr.height,act:'split',label:'Рядом — вторая колонка'})}
 else{const w=Math.round(ir.width*.45);zones.push({x:ir.left,y:ir.top,w:ir.width-w,h:ch,act:'here',label:'Открыть здесь'});zones.push({x:ir.right-w,y:ir.top,w,h:ch,act:'tab',label:'Открыть справа'})}
 const o=document.createElement('div');o.className='oly-pn-zones';o.dataset.olyZones='';o.dataset.mode=drag.mode;
 for(const z of zones){if(z.w<40||z.h<40)continue;const d=document.createElement('div');d.className='oly-pn-zone';d.dataset.act=z.act;d.setAttribute('data-thread-context-drop','true');
  Object.assign(d.style,{left:z.x+'px',top:z.y+'px',width:z.w+'px',height:z.h+'px'});
  const s=document.createElement('span');s.textContent=z.label;d.appendChild(s);
  d.addEventListener(CTX_DROP,()=>{if(drag)drag.native=z.act});   // native pointer drag released over this zone; the action runs in finishPtr
  d.addEventListener('dragenter',e=>{e.preventDefault();d.classList.add('on')});d.addEventListener('dragleave',e=>{if(!d.contains(e.relatedTarget))d.classList.remove('on')});
  d.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect=z.act==='here'?'move':'copy'});
  d.addEventListener('drop',e=>{e.preventDefault();const r=drag?.ref;endDrag();dropAct(z.act,r,'html5')});
  o.appendChild(d)}
 document.body.appendChild(o);zonesEl=o}
function zoneAt(x,y){return zonesEl?[...zonesEl.children].find(z=>{const r=z.getBoundingClientRect();return x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom})||null:null}
function hover(x,y){if(!zonesEl)return;const z=zoneAt(x,y);for(const c of zonesEl.children)c.classList.toggle('on',c===z)}
function finishPtr(x,y){const d=drag,z=zoneAt(x,y);pd=null;
 // the native sensor handles this pointerup right after us (it needs our zone under the pointer): act on the next task
 setTimeout(()=>{if(drag!==d)return;endDrag();if(z)dropAct(z.dataset.act,d.ref,d.native?'native':'pointer')},0)}
// pointer path (native rows: the sensor cancels HTML5 dragstart)
document.addEventListener('pointerdown',e=>{if(drag)endDrag();pd=null;if(e.button!==0||!e.isPrimary||e.pointerType==='touch'||e.altKey)return;
 const row=e.target?.closest?.(ROW);if(!row)return;const btn=e.target.closest('button, a, input');if(btn&&btn!==row&&row.contains(btn))return;
 const ref=refFromEl(row);if(!ref)return;const sbEl=row.closest('[data-slot=sidebar]');let sb=sbEl?.getBoundingClientRect();if(!sb||sb.width<40)sb=row.getBoundingClientRect();
 pd={ref,id:e.pointerId,x:e.clientX,y:e.clientY,label:row.getAttribute('aria-label'),sbL:sb.left,sbR:sb.right}},true);
document.addEventListener('pointermove',e=>{if(!pd||e.pointerId!==pd.id)return;
 if(drag){if(drag.mode!=='ptr')return;if(!(e.buttons&1))finishPtr(e.clientX,e.clientY);else hover(e.clientX,e.clientY);return}
 if(!(e.buttons&1)){pd=null;return}
 if(Math.hypot(e.clientX-pd.x,e.clientY-pd.y)<8||(e.clientX>=pd.sbL&&e.clientX<=pd.sbR))return;   // still inside the sidebar: native reordering
 const ir=document.querySelector('main[data-slot=sidebar-inset]')?.getBoundingClientRect();if(!ir||e.clientX<ir.left||e.clientX>ir.right||e.clientY<ir.top||e.clientY>ir.bottom)return;
 const t=threadBy(pd.ref.environmentId,pd.ref.threadId);drag={ref:pd.ref,mode:'ptr',title:t?.title||pd.label||'Чат',sbRight:pd.sbR};showZones();hover(e.clientX,e.clientY)},{capture:true,passive:true});
document.addEventListener('pointerup',e=>{if(!pd||e.pointerId!==pd.id)return;if(drag?.mode==='ptr')finishPtr(e.clientX,e.clientY);else pd=null},true);
document.addEventListener('pointercancel',e=>{if(drag?.mode==='h5'||!pd||e.pointerId!==pd.id)return;if(drag)endDrag();pd=null},true);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&drag)endDrag()},true);
addEventListener('blur',()=>{if(drag)endDrag()});
// HTML5 path: only when nobody cancelled dragstart (window bubble = after the native document listener)
addEventListener('dragstart',e=>{if(e.defaultPrevented)return;const el=e.target?.closest?.(ROW);if(!el)return;const ref=refFromEl(el);if(!ref)return;
 const t=threadBy(ref.environmentId,ref.threadId),sb=el.closest('[data-slot=sidebar]')?.getBoundingClientRect();pd=null;drag={ref,mode:'h5',title:t?.title||el.getAttribute('aria-label')||'Чат',sbRight:sb&&sb.width>=40?sb.right:0};
 try{e.dataTransfer.setData(DT,JSON.stringify(ref));e.dataTransfer.effectAllowed='copyMove';e.dataTransfer.setDragImage(ghost(drag.title),14,14)}catch{}
 const d=drag;requestAnimationFrame(()=>{if(drag===d)showZones()})});
document.addEventListener('dragend',()=>{if(drag?.mode==='h5')endDrag()},true);

/* ---------------- native sidebar rows: Alt+click, middle click, context menu ---------------- */
let ctx=null;
document.addEventListener('contextmenu',e=>{const li=e.target?.closest?.('[data-thread-item]');ctx=li?{ref:parseKey(li.getAttribute('data-thread-item')),t:Date.now()}:null},true);
document.addEventListener('click',e=>{if(!e.altKey||e.button!==0)return;const row=e.target?.closest?.(ROW);if(!row)return;
 if(e.target.closest('button, a')&&e.target.closest('button, a')!==row)return;e.preventDefault();e.stopPropagation();openBeside(refFromEl(row),e.shiftKey?'split':'tab')},true);
document.addEventListener('mousedown',e=>{if(e.button===1&&e.target?.closest?.(ROW))e.preventDefault()},true);
document.addEventListener('auxclick',e=>{if(e.button!==1)return;const row=e.target?.closest?.(ROW);if(!row)return;e.preventDefault();e.stopPropagation();openBeside(refFromEl(row),'tab')},true);
function injectMenu(){if(!ctx||Date.now()-ctx.t>2500)return;const m=document.querySelector('[role=menu][data-context-menu]');if(!m||m.querySelector('[data-oly-pm]'))return;
 const proto=m.querySelector('[role=menuitem]:not([disabled]):not([aria-disabled=true])')||m.querySelector('[role=menuitem]');if(!proto)return;
 const ref=ctx.ref,cur=curRef();const host=proto.parentElement;
 const mk=(label,icon,fn)=>{const b=document.createElement('button');b.type='button';b.setAttribute('role','menuitem');b.tabIndex=-1;b.className=proto.className.replace(/\b(pointer-events-none|cursor-not-allowed|text-muted-foreground|opacity-\d+)\b/g,'');b.dataset.olyPm='';
  b.innerHTML=svg(icon)+'<span></span>';b.querySelector('span').textContent=label;b.addEventListener('click',ev=>{ev.preventDefault();ev.stopPropagation();m.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));fn()});return b};
 const sep=document.createElement('div');sep.setAttribute('role','separator');sep.className=m.querySelector('[role=separator]')?.className||'oly-pn-sep';sep.dataset.olyPm='';
 const same=cur&&ref&&kOf(cur)===kOf(ref);if(same||!ref)return;
 host.insertBefore(sep,host.firstChild);host.insertBefore(mk('Открыть рядом в две колонки',I.cols,()=>openBeside(ref,'split')),sep);host.insertBefore(mk('Открыть справа',I.side,()=>openBeside(ref,'tab')),host.firstChild)}

/* ---------------- right panel decoration ---------------- */
function decoratePanes(){const cur=curRef();
 for(const p of document.querySelectorAll('[data-side-chat-pane]')){const tid=p.getAttribute('data-side-chat-pane');const t=cur&&threadBy(cur.environmentId,tid);
  const native=!!(t&&cur&&(t.lineage?.parentThreadId===cur.threadId||t.forkedFrom?.threadId===cur.threadId));
  if(native){if(p.hasAttribute('data-oly-foreign'))p.removeAttribute('data-oly-foreign')}else if(!p.hasAttribute('data-oly-foreign'))p.setAttribute('data-oly-foreign','');
  const hdr=p.firstElementChild;if(!hdr||!cur||hdr.querySelector(':scope > [data-oly-promote]'))continue;const close=hdr.lastElementChild;if(!close||close.tagName!=='BUTTON')continue;
  const b=document.createElement('button');b.type='button';b.className=close.className;b.dataset.olyPromote='';b.setAttribute('aria-label','Сделать основным чатом');b.title='Сделать основным (поменять местами с основным чатом)';b.innerHTML=svg(I.main);
  b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();const c=curRef();if(c)go({environmentId:c.environmentId,threadId:tid})});hdr.insertBefore(b,close)}}
function syncTabbar(){const bar=document.querySelector('main[data-slot=sidebar-inset] [data-right-panel-tabbar]');const cur=curRef();if(!bar||!cur||!M)return;
 const list=bar.querySelector('[data-right-panel-tab-list]');if(!list)return;let g=bar.querySelector(':scope > [data-oly-tabctl]');
 if(!g){g=document.createElement('div');g.className='oly-pn-tabctl';g.dataset.olyTabctl='';
  g.innerHTML='<button type="button" data-a="split">'+svg(I.cols)+'</button><button type="button" data-a="follow">'+svg(I.link)+'</button>';
  g.querySelector('[data-a=split]').addEventListener('click',toggleSplit);g.querySelector('[data-a=follow]').addEventListener('click',toggleFollow)}
 if(g.previousElementSibling!==list)list.after(g);
 const key=kOf(cur),st=panel().byThreadKey[key],on=!!P.split[key]&&P.split[key]!==st?.activeSurfaceId&&!!st?.surfaces?.some(s=>s.id===P.split[key]);
 const sb=g.querySelector('[data-a=split]'),fb=g.querySelector('[data-a=follow]');
 if(sb.getAttribute('aria-pressed')!==String(on)){sb.setAttribute('aria-pressed',String(on));sb.setAttribute('aria-label',on?'Одна колонка':'Две колонки');sb.title=on?'Показывать один чат':'Показать два чата рядом'}
 if(fb.getAttribute('aria-pressed')!==String(!!P.follow)){fb.setAttribute('aria-pressed',String(!!P.follow));fb.setAttribute('aria-label','Панель следует за основным чатом');fb.title=P.follow?'Панель следует за основным чатом: включено':'Панель следует за основным чатом: выключено'}
 const tabs=[...list.querySelectorAll('[data-active-tab]')],surf=st?.surfaces||[];
 tabs.forEach((t,i)=>{const mark=on&&surf[i]?.id===P.split[key];if(mark!==t.hasAttribute('data-oly-split-tab')){if(mark)t.setAttribute('data-oly-split-tab','');else t.removeAttribute('data-oly-split-tab')}})}
function pruneSplit(){if(!M)return;let ch=false;const all=panel().byThreadKey;for(const k of Object.keys(P.split)){const st=all[k];if(!st||!st.surfaces.some(s=>s.id===P.split[k])){delete P.split[k];ch=true}}if(ch){saveP();bump()}}

/* ---------------- css ---------------- */
const CSS_TEXT=`
.oly-psplit[data-oly-split=off],.oly-psplit[data-oly-split=off]>.oly-psplit-cell{display:contents}
.oly-psplit[data-oly-split=on]{display:flex;flex:1 1 auto;min-height:0;min-width:0;height:100%}
.oly-psplit[data-oly-split=on]>.oly-psplit-cell{display:flex;flex-direction:column;min-width:0;min-height:0;flex:1 1 0;overflow:hidden}
.oly-psplit[data-oly-split=on]>.oly-psplit-cell[data-cell=a]{flex:0 0 50%}
.oly-psplit-gutter{flex:0 0 7px;cursor:col-resize;position:relative;outline:none;touch-action:none}
.oly-psplit-gutter::after{content:"";position:absolute;inset:0 3px;background:var(--border)}
.oly-psplit-gutter:hover::after,.oly-psplit-gutter:focus-visible::after,.oly-psplit.resizing>.oly-psplit-gutter::after{inset:0 2px;background:var(--primary)}
.oly-psplit.resizing{cursor:col-resize;user-select:none}
[data-oly-foreign]>div:first-child>:nth-child(2),[data-oly-foreign]>div:first-child>:nth-child(3){display:none!important}
.oly-pn-tabctl{display:flex;align-items:center;gap:2px;flex-shrink:0;padding:0 4px;-webkit-app-region:no-drag}
.oly-pn-tabctl button{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;color:var(--muted-foreground);background:transparent;border:0;cursor:pointer}
.oly-pn-tabctl button svg{width:15px;height:15px}
.oly-pn-tabctl button:hover{background:color-mix(in srgb,var(--foreground) 8%,transparent);color:var(--foreground)}
.oly-pn-tabctl button[aria-pressed=true]{color:var(--primary);background:color-mix(in srgb,var(--primary) 14%,transparent)}
.oly-pn-tabctl button:focus-visible{outline:2px solid var(--ring);outline-offset:1px}
[data-oly-split-tab]{box-shadow:inset 0 -2px 0 color-mix(in srgb,var(--primary) 70%,transparent)}
.oly-pn-zones{position:fixed;inset:0;z-index:2147483000;pointer-events:none;-webkit-app-region:no-drag}
.oly-pn-zone{position:fixed;pointer-events:auto;display:flex;align-items:center;justify-content:center;border:2px dashed color-mix(in srgb,var(--primary) 45%,transparent);border-radius:14px;background:color-mix(in srgb,var(--primary) 6%,transparent);transition:background .12s,border-color .12s;box-sizing:border-box}
.oly-pn-zone span{font:600 13px/1.2 Inter,ui-sans-serif,system-ui,sans-serif;padding:7px 12px;border-radius:9px;background:var(--popover,var(--background));color:var(--popover-foreground,var(--foreground));box-shadow:0 6px 22px rgba(0,0,0,.18);border:1px solid var(--border)}
.oly-pn-zone.on,.oly-pn-zone[data-thread-context-over]{background:color-mix(in srgb,var(--primary) 18%,transparent);border-color:var(--primary);border-style:solid}
.oly-pn-sep{height:1px;margin:4px 6px;background:var(--border)}
.oly-pn-ghost{position:fixed;top:-200px;left:-200px;max-width:260px;padding:6px 10px;border-radius:9px;font:500 13px/1.3 Inter,ui-sans-serif,system-ui,sans-serif;background:var(--popover,var(--background));color:var(--popover-foreground,var(--foreground));border:1px solid var(--border);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.oly-pn-toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,12px);z-index:2147483001;max-width:min(520px,calc(100vw - 32px));padding:9px 14px;border-radius:10px;font:500 13px/1.35 Inter,ui-sans-serif,system-ui,sans-serif;background:var(--popover,var(--background));color:var(--popover-foreground,var(--foreground));border:1px solid var(--border);box-shadow:0 10px 30px rgba(0,0,0,.2);opacity:0;pointer-events:none;transition:opacity .15s,transform .15s}
.oly-pn-toast.on{opacity:1;transform:translate(-50%,0)}
`;
function addCss(){if(document.getElementById('oly-panels-css'))return;const s=document.createElement('style');s.id='oly-panels-css';s.textContent=CSS_TEXT;(document.head||document.documentElement).appendChild(s)}

/* ---------------- wiring ---------------- */
let pending=false,routerSub=false;
function tick(){pending=false;if(!document.body)return;
 try{
  for(const row of document.querySelectorAll('[data-slot=sidebar] [data-thread-item] > [data-sidebar-row]:not([draggable])'))row.setAttribute('draggable','true');
  if(M){onRoute();injectMenu();decoratePanes();syncTabbar();
   if(!routerSub&&RT()?.subscribe){routerSub=true;try{RT().subscribe('onResolved',()=>{onRoute();syncTabbar()})}catch{}}}
 }catch(e){console.warn('oly panels tick',e)}}
const schedule=()=>{if(!pending){pending=true;requestAnimationFrame(tick)}};
const ready=Promise.all(Object.values(CH).map(f=>import(ASSETS+f))).then(([ent,rp,re,jx])=>{
 M={ent,rp:rp.d,React:re.t(),jsx:jx.t()};
 if(!M.rp?.getState||typeof M.ent.u!=='function'||!M.React?.useReducer||typeof M.jsx?.jsx!=='function')throw new Error('unexpected chunk exports');
 defineHost();
 M.rp.subscribe?.((s,prev)=>{try{const cur=curRef();if(cur){const k=kOf(cur),a=s.byThreadKey[k]?.activeSurfaceId,b=prev?.byThreadKey?.[k]?.activeSurfaceId;
  if(a&&b&&a!==b&&P.split[k]===a&&s.byThreadKey[k].surfaces.some(x=>x.id===b&&isChat(x))){P.split[k]=b;saveP();bump()}}}catch{}schedule()});
 pruneSplit();schedule()}).catch(e=>console.warn('oly panels load',e));
globalThis.__olyPanels={ready,openBeside,toggleSplit,toggleFollow,state:{P},lastDrop:null,get core(){return M}};
// the former «Проекты» tree hid the native chat list through this class; make sure it is never left on
const start=()=>{addCss();document.documentElement.classList.remove('oly-ptree-on');new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});schedule()};
document.body?start():addEventListener('DOMContentLoaded',start);
}catch(e){console.warn('oly chat-panels',e)}})();

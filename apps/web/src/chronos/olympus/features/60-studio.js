;(()=>{try{
/* ---- Studio: local Excalidraw boards + WordPress Playground in T3's right panel (service 127.0.0.1:4520) ----
   Opens URLs as native browser tabs of the right panel through the app's own WebSocket RPC (`preview.open`),
   so agents can drive them with T3's preview tools. The service can ask this window to open things (SSE /api/bridge). */
if(globalThis.__olyStudio)return;
const SVC='http://127.0.0.1:4520';
const LSK=k=>{try{return localStorage.getItem('oly-studio-'+k)}catch(e){return null}};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const S=globalThis.__olyStudio={ws:null,threadId:null,cwd:null,appRuntime:undefined,pending:new Map(),seq:900000000+(Date.now()%80000000),lastOpen:0};

/* ---- 1. observe the app's RPC socket (read-only except our own requests) ---- */
const nativeSend=WebSocket.prototype.send;
function onOut(ws,d){
 if(typeof d!=='string'||d.charCodeAt(0)!==123||d.indexOf('"_tag":"Request"')<0)return;
 let m;try{m=JSON.parse(d)}catch(e){return}
 onOutMsg(ws,m)}
function onOutMsg(ws,m){
 if(!m||m._tag!=='Request')return;S.ws=ws;
 const p=m&&m.payload||{};
 if(m.tag==='preview.list'&&typeof p.threadId==='string'){S.ws=ws;if(S.threadId!==p.threadId){S.threadId=p.threadId;ctxChanged()}}
 else if(m.tag==='preview.open'&&!(m.id>=900000000)){S.ws=ws;S.appRuntime=p.runtime}
 else if(m.tag==='projects.readFile'&&p.relativePath==='t3.json'&&typeof p.cwd==='string'){if(S.cwd!==p.cwd){S.cwd=p.cwd;ctxChanged()}}
}
function hookIn(ws){if(ws.__olyStudioIn)return;ws.__olyStudioIn=1;let buf='';
 ws.addEventListener('message',e=>{try{let d=e.data;if(typeof d!=='string'||!S.pending.size)return;
  if(d.charCodeAt(0)===30){buf+=d.slice(1);if(buf.length>8e6)buf='';return}if(buf){d=buf+d;buf=''}
  if(d.indexOf('"requestId":9')<0)return;
  for(const[id,h]of S.pending){if(d.indexOf('"requestId":'+id)<0)continue;let m;try{m=JSON.parse(d)}catch(_){return}
   const arr=Array.isArray(m)?m:[m];for(const x of arr){if(x&&x._tag==='Exit'&&String(x.requestId)===String(id)){S.pending.delete(id);clearTimeout(h.t);
    x.exit&&x.exit._tag==='Success'?h.res(x.exit.value):h.rej(new Error(failText(x.exit)))}}}
 }catch(_){}})}
/* Find the app socket. Other modules (40-files) give every socket its own instance `send`, which bypasses a prototype patch,
   so: the shared bus (05-oly-core, sees every outgoing frame with its socket) or, without it, a constructor wrapper that chains the instance send. */
const isAppWs=ws=>!!(ws&&typeof ws.url==='string'&&ws.url.indexOf('/ws')>=0);
const core=globalThis.__olyCore;
if(core&&typeof core.onWsSend==='function'){
 core.onWsSend((m,meta)=>{const ws=meta&&meta.socket;if(!isAppWs(ws))return;hookIn(ws);onOutMsg(ws,m)},{contains:['"_tag":"Request"']});
}else{
 WebSocket.prototype.send=function(d){try{if(isAppWs(this)){hookIn(this);onOut(this,d)}}catch(e){}return nativeSend.call(this,d)};
 const NWS=window.WebSocket;
 if(NWS&&!NWS.__olyStudio){const W=function(...a){const ws=new NWS(...a);try{if(isAppWs(ws)&&Object.prototype.hasOwnProperty.call(ws,'send')){const own=ws.send;ws.send=function(d){try{hookIn(ws);onOut(ws,d)}catch(_){}return own.call(this,d)}}}catch(_){}return ws};
  W.prototype=NWS.prototype;for(const k of['CONNECTING','OPEN','CLOSING','CLOSED'])W[k]=NWS[k];for(const k of Object.keys(NWS))if(k.startsWith('__oly'))W[k]=NWS[k];W.__olyStudio=true;window.WebSocket=W}
}
function failText(exit){try{const s=JSON.stringify(exit&&exit.cause||exit);const m=/"message":"([^"]{1,200})"/.exec(s)||/"_tag":"([A-Za-z]+Error)"/.exec(s);return m?m[1]:'Ошибка T3'}catch(e){return 'Ошибка T3'}}
function rpc(tag,payload,timeout=20000){return new Promise((res,rej)=>{const ws=S.ws;
 if(!ws||ws.readyState!==1)return rej(new Error('Нет соединения с сервером T3 — откройте тред и попробуйте ещё раз'));
 const id=++S.seq;const t=setTimeout(()=>{S.pending.delete(id);rej(new Error('T3 не ответил'))},timeout);
 S.pending.set(id,{res,rej,t});
 try{nativeSend.call(ws,JSON.stringify({_tag:'Request',id,tag,payload,traceId:Math.random().toString(16).slice(2).padEnd(32,'0').slice(0,32),spanId:Math.random().toString(16).slice(2).padEnd(16,'0').slice(0,16),sampled:false,headers:[]}))}
 catch(e){clearTimeout(t);S.pending.delete(id);rej(e)}})}

/* ---- 2. context (current thread + project folder) → service, for agents' defaults ---- */
function routeThread(){for(const p of [location.hash.replace(/^#/,''),location.pathname]){const m=/^\/([^/]+)\/([0-9a-f-]{20,})(?:[/?#]|$)/i.exec(p);if(m&&m[1]!=='draft')return m[2]}return null}
let ctxTimer=null;
function ctxChanged(){clearTimeout(ctxTimer);ctxTimer=setTimeout(()=>{fetch(SVC+'/api/context',{method:'POST',headers:{'x-oly':'1','content-type':'application/json'},body:JSON.stringify({threadId:curThread(),cwd:S.cwd})}).catch(()=>{})},400)}
const curThread=()=>routeThread();

/* ---- 3. open in the right panel ---- */
function themeHash(){const r=document.documentElement,cs=getComputedStyle(r);const v=n=>encodeURIComponent((cs.getPropertyValue(n)||'').trim());
 const parts=['theme='+(r.classList.contains('dark')?'dark':'light'),'olympus='+(/^olympus/.test(r.getAttribute('data-theme-id')||'')?'1':'0')];
 for(const[k,n]of[['bg','--background'],['fg','--foreground'],['muted','--muted-foreground'],['border','--border'],['panel','--card'],['accent','--accent'],['primary','--primary'],['primary-fg','--primary-foreground']]){const x=v(n);if(x)parts.push(k+'='+x)}
 return '#'+parts.join('&')}
const isOly=()=>/^olympus/.test(document.documentElement.getAttribute('data-theme-id')||'');
const hubUrl=tab=>SVC+'/?'+(S.cwd?'cwd='+encodeURIComponent(S.cwd)+'&':'')+'tab='+(tab==='wp'?'wp':'boards');
const boardUrl=p=>SVC+'/board?path='+encodeURIComponent(p);
const noHash=u=>String(u||'').split('#')[0];
const tabList=()=>document.querySelector('[data-right-panel-tab-list]');
const tabEls=()=>{const l=tabList();return l?[...l.querySelectorAll('[data-active-tab]')]:[]};
function panelToggle(){return document.querySelector('button[aria-label="Toggle right panel"],button[aria-label="Показать или скрыть правую панель"]')}
async function ensurePanel(){if(tabList()||document.querySelector('[data-surface-launcher-keys]'))return;const b=panelToggle();if(b){b.click();for(let i=0;i<20&&!tabList()&&!document.querySelector('[data-surface-launcher-keys]');i++)await sleep(100)}}
async function activate(pick,ms=6000){const end=Date.now()+ms;while(Date.now()<end){const el=pick();if(el){if(el.getAttribute('data-active-tab')!=='true'){const bs=[...el.querySelectorAll('button')];(bs.find(b=>b.classList.contains('min-w-0'))||bs[1]||el).click()}return true}await sleep(150)}return false}
function runtimeOpt(){const f=LSK('runtime');if(f==='server')return{runtime:'server'};if(f==='desktop')return{};
 if(S.appRuntime!==undefined)return S.appRuntime?{runtime:S.appRuntime}:{};return window.desktopBridge?{}:{runtime:'server'}}
/* match: url prefix (without hash) that identifies an already open tab; replace: close it and reopen with the new url */
async function openInPanel(url,{match,replace,title}={}){
 const threadId=curThread();
 if(!threadId||!S.ws||S.ws.readyState!==1||document.querySelector('[data-oly-studio-overlay]'))return openOverlay(url,title);
 await ensurePanel();
 let list=null;try{list=await rpc('preview.list',{threadId},8000)}catch(e){}
 const sessions=list?(Array.isArray(list)?list:(list.sessions?Object.values(list.sessions):Object.values(list))).filter(x=>x&&x.tabId):[];
 const want=noHash(match||url);
 const hit=sessions.find(s=>{const u=noHash(s.navStatus&&s.navStatus.url);return u&&(match?u.startsWith(want):u===want)});
 if(hit&&!(replace&&noHash(hit.navStatus.url)!==noHash(url))){const t=(hit.navStatus&&hit.navStatus.title)||title||'';
  if(await activate(()=>tabEls().find(el=>t&&el.textContent.trim()===t.trim())||tabEls().find(el=>t&&el.textContent.includes(t)),2500))return hit;}
 if(hit&&replace){try{await rpc('preview.close',{threadId,tabId:hit.tabId},8000)}catch(e){}}
 const nBefore=tabEls().length;
 let res;try{res=await rpc('preview.open',{threadId,url,viewport:{_tag:'fill'},profileId:'default',...runtimeOpt(),...(runtimeOpt().runtime?{colorScheme:'system',zoomFactor:1}:{}),reveal:true},8000)}catch(e){return openOverlay(url,title)}
 // new tabs are appended at the end of the tab strip; prefer an exact title match once the page has loaded
 await activate(()=>{const els=tabEls();return els.find(el=>title&&el.textContent.trim().includes(title))||(els.length>nBefore?els[els.length-1]:null)});
 return res}
function openOverlay(url,title){return globalThis.__olyStudioShell.open(url,title)}
S.routeThread=routeThread;S.openOverlay=openOverlay;
function report(e){toast(e&&e.message||String(e),true)}
async function currentCwd(){
 const id=curThread();if(S._cwdThread!==id){S._cwdThread=id;S.cwd=null}if(!id)return;
 try{const r=await fetch('http://127.0.0.1:4518/api/thread/'+encodeURIComponent(id),{signal:AbortSignal.timeout(1800)});const t=await r.json();if(!t.projectId)return;
  const p=await fetch('http://127.0.0.1:4518/api/projects',{signal:AbortSignal.timeout(1800)});const projects=await p.json();
  if(Array.isArray(projects))S.cwd=projects.find(p=>p.id===t.projectId)?.root||null;
 }catch{}ctxChanged();
}
const openHub=async tab=>{await currentCwd();return openOverlay(hubUrl(tab)+themeHash(),'Студия').catch(report)};
/* from the right panel's own menus: the hub opens as a tab of the panel; picking a board there opens it in the same tab */
const openHubInPanel=async tab=>{await currentCwd();return openInPanel(hubUrl(tab)+themeHash(),{match:SVC+'/?',title:'Студия'}).catch(report)};
const openBoard=p=>openInPanel(boardUrl(p)+themeHash(),{title:p.split(/[\\/]/).pop().replace(/\.excalidraw$/i,'')}).catch(report);
const openSite=s=>openInPanel(s.adminUrl,{match:s.url,title:'WordPress'}).catch(report);
S.openHub=openHub;S.openBoard=openBoard;S.openInPanel=openInPanel;

/* ---- 3b. "В чат" on a board: attach its PNG snapshot (as a normal pasted image) + the file path to the composer ---- */
function composerEd(){return document.querySelector('[data-slot=composer-host] .composer-tiptap')}
async function attachBoard(m){
 const ed=composerEd();if(!ed){toast('Откройте тред — тогда доску можно отправить в чат',true);return}
 let file=null;
 if(m.png){try{const r=await fetch(SVC+m.png,{cache:'no-store'});if(r.ok){const b=await r.blob();file=new File([b],String(m.title||'board').replace(/[\\/:*?"<>|]+/g,'_')+'.png',{type:'image/png'})}}catch(e){}}
 ed.focus();const sel=getSelection();sel.selectAllChildren(ed);sel.collapseToEnd();
 const empty=!ed.textContent.trim();
 document.execCommand('insertText',false,(empty?'':'\n')+'Доска Excalidraw «'+(m.title||'')+'»'+(m.selection?' (выделенный фрагмент)':'')+': '+m.path+' ');
 let attached=false;
 if(file){const dt=new DataTransfer();dt.items.add(file);const ev=new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true});ed.dispatchEvent(ev);attached=ev.defaultPrevented}
 toast(attached?'Снимок доски и путь добавлены в сообщение':file?'Путь добавлен, но снимок прикрепить не удалось':'Путь к доске добавлен в сообщение',!!file&&!attached)}
S.attachBoard=attachBoard;

/* ---- 4. bridge: the service (MCP tools, hub page) asks this window to open something ---- */
const seen=new Set();let es=null,backoff=4000;
function bridge(){try{es=new EventSource(SVC+'/api/bridge')}catch(e){return}
 es.addEventListener('hello',()=>{backoff=4000;ctxChanged()});
 es.addEventListener('open',ev=>{let m;try{m=JSON.parse(ev.data)}catch(e){return}if(!m||seen.has(m.id))return;seen.add(m.id);
  if(document.visibilityState!=='visible')return;
  if(m.kind==='board')openBoard(m.path);else if(m.kind==='hub')openHub(m.tab);else if(m.kind==='url')openInPanel(m.url,{match:m.match}).catch(report)});
 es.addEventListener('chat',ev=>{let m;try{m=JSON.parse(ev.data)}catch(e){return}if(!m||seen.has(m.id))return;seen.add(m.id);
  if(m.to&&m.to!==LSK('client'))return;if(document.visibilityState!=='visible')return;attachBoard(m).catch(report)});
 es.onerror=()=>{try{es.close()}catch(e){}es=null;setTimeout(bridge,backoff);backoff=Math.min(backoff*2,120000)}}

/* ---- 5. UI: sidebar footer button + menu, launcher entries ---- */
const ICON_STUDIO='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>';
const ICON_BOARD='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const ICON_WP='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>';
const ICON_PLUS='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';
const ICON_GRID='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>';
const css=document.createElement('style');css.id='oly-studio-css';css.textContent=`
.oly-studio-pop{position:fixed;z-index:140;width:300px;max-height:min(560px,calc(100vh - 24px));overflow:auto;padding:4px;background:var(--popover,var(--background));color:var(--popover-foreground,var(--foreground));border:1px solid var(--border);border-radius:var(--radius,10px);box-shadow:0 10px 32px -8px #0005,0 2px 6px -2px #0002;font-size:13px}
.oly-studio-pop .h{display:flex;align-items:baseline;gap:8px;padding:8px 8px 6px}
.oly-studio-pop .h b{font-weight:600;font-size:13px}
.oly-studio-pop .h span{color:var(--muted-foreground);font-size:12px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.oly-studio-pop .g{padding:8px 8px 2px;font-size:11.5px;color:var(--muted-foreground)}
.oly-studio-pop .it{display:flex;align-items:center;gap:8px;width:100%;min-height:28px;padding:4px 8px;border:0;border-radius:calc(var(--radius,10px) - 4px);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.oly-studio-pop .it:hover,.oly-studio-pop .it:focus-visible{background:color-mix(in srgb,var(--foreground) 9%,transparent);outline:none}
.oly-studio-pop .it svg{width:15px;height:15px;flex-shrink:0;color:var(--muted-foreground)}
.oly-studio-pop .it .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.oly-studio-pop .it .m{color:var(--muted-foreground);font-size:11.5px;white-space:nowrap}
.oly-studio-pop .sep{height:1px;margin:4px 0;background:var(--border)}
.oly-studio-pop .msg{padding:10px 8px;color:var(--muted-foreground);line-height:1.5}
.oly-studio-pop .msg code{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;color:var(--foreground)}
.oly-studio-pop form{display:flex;gap:6px;padding:4px 8px 6px}
.oly-studio-pop input{flex:1;min-width:0;height:28px;padding:0 8px;border:1px solid var(--border);border-radius:var(--control-radius,6px);background:var(--background);color:var(--foreground);font:inherit}
.oly-studio-pop input:focus{outline:none;border-color:var(--ring,var(--primary))}
.oly-studio-pop .dot{width:7px;height:7px;border-radius:50%;background:var(--muted-foreground);opacity:.6;flex-shrink:0;margin:0 4px}
.oly-studio-pop .dot.running{background:#16a34a;opacity:1}.oly-studio-pop .dot.starting{background:#d97706;opacity:1}.oly-studio-pop .dot.error{background:#dc2626;opacity:1}
.oly-studio-toast{position:fixed;z-index:150;left:50%;bottom:22px;transform:translateX(-50%);max-width:min(520px,90vw);padding:8px 12px;border-radius:var(--radius,10px);background:var(--foreground);color:var(--background);font-size:13px;box-shadow:0 8px 24px #0004}
.oly-studio-toast.err{background:#b91c1c;color:#fff}
[data-oly-studio-mi]:hover{background:var(--accent);color:var(--accent-foreground)}`;
let toastT=null;function toast(m,err){let t=document.querySelector('.oly-studio-toast');if(!t){t=document.createElement('div');t.className='oly-studio-toast';document.body.appendChild(t)}t.className='oly-studio-toast'+(err?' err':'');t.textContent=m;clearTimeout(toastT);toastT=setTimeout(()=>t.remove(),err?6000:3000)}
async function svc(p,body){const c=new AbortController();const tm=setTimeout(()=>c.abort(),12000);try{const r=await fetch(SVC+p,body?{method:'POST',headers:{'x-oly':'1','content-type':'application/json'},body:JSON.stringify(body),signal:c.signal}:{cache:'no-store',signal:c.signal});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||r.statusText);return j}finally{clearTimeout(tm)}}

/* replace an app icon, keeping its size classes (size-4 etc.) */
function swapIcon(old,html){if(!old)return;const t=document.createElement('template');t.innerHTML=html;const n=t.content.firstElementChild;const c=(old.getAttribute('class')||'').split(/\s+/).filter(x=>x&&!/^lucide-/.test(x)).join(' ');if(c)n.setAttribute('class',c);old.replaceWith(n)}
function closePop(){const p=document.querySelector('.oly-studio-pop');if(p)p.remove()}
async function openPop(anchor){
 if(document.querySelector('.oly-studio-pop')){closePop();return}
 const pop=document.createElement('div');pop.className='oly-studio-pop';pop.setAttribute('role','menu');pop.setAttribute('aria-label','Студия');
 pop.innerHTML='<div class="h"><b>Студия</b><span>Загрузка…</span></div>';document.body.appendChild(pop);
 const place=()=>{const r=anchor.getBoundingClientRect();pop.style.left=Math.max(8,Math.min(r.left,innerWidth-pop.offsetWidth-8))+'px';pop.style.bottom=Math.max(8,innerHeight-r.top+6)+'px'};place();
 let locs,boards,recent;const sitesP=svc('/api/wp/sites').catch(()=>null);
 try{[locs,recent]=await Promise.all([svc('/api/locations?cwd='+encodeURIComponent(S.cwd||'')),svc('/api/recent')]);
  const cur=locs.locations.find(l=>l.current);boards=(await svc('/api/boards?dir='+encodeURIComponent(cur.dir))).boards;
  const seenP=new Set(boards.map(b=>b.path.toLowerCase()));const rec=recent.recent.filter(r=>!seenP.has(r.path.toLowerCase())).slice(0,Math.max(0,6-Math.min(boards.length,5)));
  const when=t=>new Date(t).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
  const ST={running:'работает',starting:'запуск…',stopped:'остановлен',error:'ошибка'};
  pop.innerHTML=`<div class="h"><b>Студия</b><span>${esc(cur.kind==='project'?cur.title:'Без проекта · папка студии')}</span></div>
   <div class="g">Доски Excalidraw</div>
   ${boards.slice(0,5).map(b=>`<button class="it" data-board="${esc(b.path)}" role="menuitem">${ICON_BOARD}<span class="n">${esc(b.name)}</span><span class="m">${when(b.mtime)}</span></button>`).join('')}
   ${rec.map(b=>`<button class="it" data-board="${esc(b.path)}" role="menuitem" title="${esc(b.path)}">${ICON_BOARD}<span class="n">${esc(b.name)}</span><span class="m">недавняя</span></button>`).join('')}
   <form data-new><input placeholder="Новая доска…" aria-label="Название новой доски" maxlength="100"></form>
   <button class="it" data-hub="boards" role="menuitem">${ICON_GRID}<span class="n">Все доски и папки</span></button>
   <div class="sep"></div><div class="g">WordPress Playground</div>
   <div data-sites><div class="msg">Загрузка сайтов…</div></div>
   <button class="it" data-hub="wp" role="menuitem">${ICON_PLUS}<span class="n">Все сайты, новый сайт</span></button>`;
  pop.querySelectorAll('[data-board]').forEach(b=>b.onclick=()=>{closePop();openBoard(b.dataset.board)});
  pop.querySelectorAll('[data-hub]').forEach(b=>b.onclick=()=>{closePop();openHub(b.dataset.hub)});
  sitesP.then(sites=>{const box=pop.querySelector('[data-sites]');if(!box)return;if(!sites){box.innerHTML='<div class="msg">Не удалось получить список сайтов.</div>';return}
   const mySites=sites.sites.filter(s=>cur.kind==='project'&&s.root&&s.root.toLowerCase()===cur.root.toLowerCase());
   const siteRows=(mySites.length?mySites:sites.sites).slice(0,5);
   box.innerHTML=siteRows.map(s=>`<button class="it" data-site="${esc(s.id)}" role="menuitem">${ICON_WP}<span class="n">${esc(s.name)}</span><span class="dot ${s.status}"></span><span class="m">${ST[s.status]||s.status}</span></button>`).join('')||'<div class="msg">Сайтов пока нет.</div>';
   place();
  box.querySelectorAll('[data-site]').forEach(b=>b.onclick=async()=>{closePop();const s=sites.sites.find(x=>x.id===b.dataset.site);
   try{if(s.status!=='running'){toast('Запускаю «'+s.name+'»… первый запуск может занять минуту');await svc('/api/wp/start',{id:s.id});
     for(let i=0;i<160;i++){await sleep(1500);const j=await svc('/api/wp/sites');const x=j.sites.find(y=>y.id===s.id);if(!x||x.status==='running')break;if(x.status==='error')throw new Error('WordPress не запустился — журнал в «Все сайты»')}}
    await openSite(s)}catch(e){report(e)}})});
  const f=pop.querySelector('[data-new]');f.onsubmit=async e=>{e.preventDefault();const n=f.querySelector('input').value.trim();if(!n)return;
   try{const j=await svc('/api/board/create',{dir:cur.dir,name:n});closePop();openBoard(j.path)}catch(err){report(err)}};
 }catch(e){pop.innerHTML='<div class="h"><b>Студия</b></div><div class="msg">Сервис студии не запущен.<br>Он стартует при входе в Windows. Вручную: <code>t3-studio.vbs</code> в папке автозагрузки.</div>'}
 place();
}
addEventListener('pointerdown',e=>{const p=document.querySelector('.oly-studio-pop');if(p&&!p.contains(e.target)&&!e.target.closest('[data-oly-studio]'))closePop()},true);
addEventListener('keydown',e=>{if(e.key==='Escape'&&document.querySelector('.oly-studio-pop'))closePop()},true);

function ensureButton(){if(document.querySelector('[data-oly-studio]'))return;
 const usage=document.querySelector('[data-slot=sidebar] button[aria-label="Usage"],[data-slot=sidebar] button[aria-label="Расход"]');if(!usage)return;
 const item=usage.parentElement&&usage.parentElement.closest('li')||usage.parentElement;if(!item||!item.parentElement)return;
 const after=document.querySelector('[data-oly-skills]')||item;
 const clone=item.cloneNode(true);clone.removeAttribute('data-oly-skills');clone.setAttribute('data-oly-studio','');const b=clone.matches('button')?clone:clone.querySelector('button');if(!b)return;
 b.setAttribute('aria-label','Студия');b.title='Студия — доски Excalidraw и WordPress';b.removeAttribute('data-state');b.removeAttribute('aria-expanded');swapIcon(b.querySelector('svg'),ICON_STUDIO);
 b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();openHub('boards')});b.addEventListener('contextmenu',e=>{e.preventDefault();openPop(b)});after.parentElement.insertBefore(clone,after.nextSibling)}
function ensureLauncher(){const box=document.querySelector('[data-surface-launcher-keys]');if(!box||box.querySelector('[data-oly-studio-launch]'))return;
 const rows=[...box.querySelectorAll('button')].map(b=>b.closest('.group')||b).filter(Boolean);const proto=rows[rows.length-1];if(!proto||!proto.parentElement)return;
 for(const[key,label,icon,fn]of[['boards','Excalidraw',ICON_BOARD,()=>openHubInPanel('boards')],['wp','WordPress',ICON_WP,()=>openHubInPanel('wp')]]){
  const row=proto.cloneNode(true);row.setAttribute('data-oly-studio-launch',key);row.removeAttribute('onmouseenter');
  row.querySelectorAll('button:not(:first-of-type)').forEach(x=>x.remove());
  const btn=row.matches('button')?row:row.querySelector('button');if(!btn)continue;btn.classList.remove('bg-accent/60');
  const spans=[...btn.children];swapIcon(btn.querySelector('svg'),icon);
  const lab=spans.find(s=>s.tagName==='SPAN'&&s.classList.contains('flex-1'))||spans[1];if(lab){lab.textContent=label;lab.classList.remove('pr-7')}
  spans.filter(s=>s!==lab&&!s.querySelector('svg')&&s!==btn.firstElementChild).forEach(s=>s.remove());
  btn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();fn()});
  proto.parentElement.appendChild(row)}}

/* the right panel's "+" (Add panel) menu: Terminal / Files / Device → append Excalidraw and WordPress */
function ensureAddMenu(){for(const menu of document.querySelectorAll('[data-slot=menu-popup]')){if(menu.querySelector('[data-oly-studio-mi]'))continue;
 const items=[...menu.querySelectorAll('[data-slot=menu-item]')];if(!items.some(i=>/^(Терминал|Terminal)/.test(i.textContent.trim()))||!items.some(i=>/^(Файлы|Files)/.test(i.textContent.trim())))continue;
 const proto=items[items.length-1];
 for(const[key,label,icon,fn]of[['boards','Excalidraw',ICON_BOARD,()=>openHubInPanel('boards')],['wp','WordPress',ICON_WP,()=>openHubInPanel('wp')]]){
  const it=proto.cloneNode(true);it.setAttribute('data-oly-studio-mi',key);it.removeAttribute('id');it.removeAttribute('aria-keyshortcuts');it.removeAttribute('data-highlighted');
  swapIcon(it.querySelector('svg'),icon);
  [...it.childNodes].forEach(n=>{if(n.nodeType===3)n.remove();else if(n.tagName!=='svg')n.remove()});it.appendChild(document.createTextNode(label));
  it.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));menu.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));fn()});
  proto.parentElement.appendChild(it)}}}
let pend=false;const tick=()=>{pend=false;ensureButton();ensureLauncher();ensureAddMenu();const t=routeThread();if(t&&t!==S._rt){S._rt=t;ctxChanged()}};
const start=()=>{if(!css.isConnected)(document.head||document.body).appendChild(css);new MutationObserver(()=>{if(!pend){pend=true;requestAnimationFrame(tick)}}).observe(document.body,{childList:true,subtree:true});tick();setTimeout(bridge,1500)};
document.body?start():addEventListener('DOMContentLoaded',start);
}catch(e){console.warn('oly studio',e)}})();

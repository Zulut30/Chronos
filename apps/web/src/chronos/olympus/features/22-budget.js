;(()=>{try{
'use strict';
if (globalThis.__olyBudget) return;

// Both modules consume the same decoded T3 records, including compact snapshot IDs.
const listeners = new Set(), endpoints = new Map(), socketEnvironments = new WeakMap();
const frameMarkers = ['provider-turn.updated','provider-thread.updated','runtime-request.updated','thread.updated','thread.metadata-updated','run.updated','run.created','"approval_request"','"user_input_request"','"secret_request"','"projection"','"snapshot"','"welcome"','"providerStatuses"','"providerStatusDeltas"','"usageLimitSourcesUpdated"'];
const environments = new Map();
const drivers = {claudeAgent:'Claude',codex:'Codex',antigravity:'Antigravity',gemini:'Gemini',cursor:'Cursor',opencode:'OpenCode'};
function account(row, sourceId) {
  const limits=row?.usageLimits;
  if (!row?.driver || !Array.isArray(limits?.windows) || limits.unavailable) return null;
  if (!sourceId && (!row.enabled || !row.installed || row.availability==='unavailable' || row.auth?.status==='unauthenticated')) return null;
  const windows=limits.windows.filter(w=>w && Number.isFinite(w.usedPercent) && w.label).map(w=>({
    label:windowLabel(w), left:Math.round(100-Math.max(0,Math.min(100,w.usedPercent))), reset:Date.parse(w.resetsAt)
  }));
  if (!windows.length) return null;
  const auth=row.auth || row;
  return {driver:row.driver,name:row.displayName || drivers[row.driver] || row.driver,
    plan:sourceId ? row.plan : row.auth?.label, identity:auth.email?.trim().toLowerCase() || limits.credentialFingerprint,
    workspace:auth.workspaceId, id:sourceId ? [sourceId,row.id] : [row.instanceId],
    checked:Date.parse(limits.checkedAt)||0,windows};
}
function windowLabel(w) {
  const minutes=w.windowDurationMins;
  const session=minutes>0 ? (minutes%60===0 ? (minutes/60)+' ч' : minutes+' мин') : 'Сессия';
  const words={Weekly:'Неделя',Monthly:'Месяц',Daily:'День',Session:session,'5h':'5 ч','5-hour':'5 ч'};
  return w.label.split(' · ').map(part=>words[part] || part).join(' · ');
}
function updateLimits(event,env) {
  if (event.version!==1 || !env) return;
  const snapshot=event.type==='snapshot' && Array.isArray(event.config?.providers);
  const providers=snapshot ? event.config.providers : ['providerStatuses','providerStatusDeltas'].includes(event.type) ? event.payload?.providers : null;
  const sources=snapshot ? event.config.usageLimitSources : event.type==='usageLimitSourcesUpdated' ? event.payload?.sources : null;
  if (!Array.isArray(providers) && !Array.isArray(sources)) return;
  const state=environments.get(env) || {providers:[],sources:[]};
  // A status delta elides catalogs only. Its provider list and usageLimits replace the previous ones.
  if (Array.isArray(providers)) state.providers=providers.map(row=>account(row)).filter(Boolean);
  if (Array.isArray(sources)) state.sources=sources.flatMap(s=>(s.accounts||[]).map(row=>account(row,s.id))).filter(Boolean);
  environments.set(env,state);
  schedulePaint();
}
function subscriptions(now) {
  const accounts=new Map(),workspaces=new Map();
  const rows=[];
  for (const [env,state] of environments) {
    for (const item of [...state.providers,...state.sources]) {
      const identity=item.identity && JSON.stringify([item.driver,item.identity]);
      if (identity && item.workspace) {
        if (!workspaces.has(identity)) workspaces.set(identity,new Set());
        workspaces.get(identity).add(item.workspace);
      }
      rows.push({env,item,identity});
    }
  }
  for (const {env,item,identity} of rows) {
    const spaces=workspaces.get(identity);
    const workspace=item.workspace || (spaces?.size===1 ? [...spaces][0] : '');
    const key=identity && (workspace || !spaces?.size) ? JSON.stringify([identity,workspace]) : JSON.stringify([env,...item.id]);
    const old=accounts.get(key);
    if (!old || item.checked>old.checked) accounts.set(key,{...item,name:old?.name || item.name,plan:item.plan || old?.plan});
  }
  const visible=[];
  for (const item of accounts.values()) {
    const windows=item.windows.filter(w=>!Number.isFinite(w.reset) || w.reset>now);
    if (windows.length) visible.push({...item,windows});
  }
  return visible;
}
function ingest(frame, meta = {}) {
  let socket = '';
  try { const url = new URL(meta.url); socket = url.origin + url.pathname; } catch {}
  function visit(o, ids) {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { for (const entry of o) visit(entry, ids); return; }
    ids = o.ids || ids;
    const id = value => typeof value === 'number' ? ids?.[value] : value;
    const announced=o.type==='welcome' ? o.payload?.environment?.environmentId : o.type==='snapshot' ? o.config?.environment?.environmentId : null;
    if (typeof announced==='string' && announced) {
      endpoints.set(socket, announced);
      if (meta.socket) socketEnvironments.set(meta.socket, announced);
    }
    const env = socketEnvironments.get(meta.socket) || endpoints.get(socket);
    if (o.version===1 && ['snapshot','providerStatuses','providerStatusDeltas','usageLimitSourcesUpdated'].includes(o.type)) {
      updateLimits(o,env || socket);
      if (o.config || o.payload || o.type!=='snapshot') return;
    }
    function emit(kind, record, thread, snapshot = false) {
      if (typeof thread !== 'string' || !thread) return;
      for (const fn of listeners) { try { fn({kind, record, thread, id, env, snapshot}); } catch { /* isolate subscribers */ } }
    }
    if (o.event?.type && o.event.payload) {
      const e = o.event;
      emit(e.type, e.payload, id(e.threadId) || id(e.payload.threadId));
      return;
    }
    if (o.kind === 'thread.updated' && o.thread) {
      if (o.location !== 'archive') emit('shell', o.thread, id(o.thread.id));
      return;
    }
    if (o.snapshot?.threads) {
      for (const row of o.snapshot.threads) emit('shell', row, id(row.id), true);
      return;
    }
    const p = o.projection;
    if (p?.thread) {
      const thread = id(p.thread.id);
      emit('thread.metadata-updated', p.thread, thread, true);
      for (const row of p.providerThreads || []) emit('provider-thread.updated', row, thread, true);
      for (const row of p.providerTurns || []) emit('provider-turn.updated', row, thread, true);
      for (const row of p.runs || []) emit('run.updated', row, thread, true);
      for (const row of p.runtimeRequests || []) emit('runtime-request.updated', row, thread, true);
      return;
    }
    // Effect RPC Chunk/Exit plus the transport's batch envelopes. Never walk tool output.
    for (const key of ['values','value','exit','payload','result','data','items']) {
      if (o[key] && typeof o[key] === 'object') visit(o[key], ids);
    }
  }
  visit(frame, null);
}
if (globalThis.__olyCore?.onWsFrame) globalThis.__olyCore.onWsFrame(ingest,{contains:frameMarkers});
else if (globalThis.WebSocket) {
  globalThis.WebSocket = new Proxy(globalThis.WebSocket, {construct(target, args, ctor) {
    const ws = Reflect.construct(target, args, ctor);
    let chunks = '';
    ws.addEventListener('message', ({data}) => {
      if (typeof data !== 'string') return;
      if (data.charCodeAt(0) === 30) { chunks += data.slice(1); if (chunks.length > 64e6) chunks = ''; return; }
      const message = chunks + data; chunks = '';
      if (!frameMarkers.some(marker => message.includes(marker))) return;
      try { ingest(JSON.parse(message), {url: ws.url,socket:ws}); } catch {}
    });
    return ws;
  }});
}
function route() {
  const path = location.hash.startsWith('#/') ? location.hash.slice(1) : location.pathname;
  const parts = path.split(/[?#]/,1)[0].split('/').filter(Boolean);
  if (parts[0] === 'threads') parts.shift();
  if (parts.length !== 2 || ['settings','draft','usage','new'].includes(parts[0]) || parts[1] === 'new') return {};
  try { return {env:decodeURIComponent(parts[0]), thread:decodeURIComponent(parts[1])}; } catch { return {}; }
}
function onMount(fn) {
  if (globalThis.__olyCore?.onUiMount) globalThis.__olyCore.onUiMount(fn);
  else {
    let scheduled = false;
    new MutationObserver(records => {
      if (scheduled || !records.some(r => r.addedNodes.length && !r.target.closest?.('.chat-markdown,pre,code,.xterm,[contenteditable=true],.oly-budget-pop,.oly-notify-wrap'))) return;
      scheduled = true; requestAnimationFrame(() => { scheduled = false; fn(); });
    }).observe(document.documentElement, {childList:true, subtree:true});
  }
  if (globalThis.__olyCore?.onRoute) globalThis.__olyCore.onRoute(fn);
  else { addEventListener('hashchange',fn); addEventListener('popstate',fn); }
  fn();
}
const node = (tag, cls, value) => { const el=document.createElement(tag); if(cls) el.className=cls; if(value!=null) el.textContent=value; return el; };
const bus = {route,onMount,node,subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn)}};
globalThis.__olyBudgetEvents = bus;
dispatchEvent(new Event('oly-budget-wire-ready'));

const threads = new Map();
function usd(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value>0 ? value : null;
  return typeof value?.currency === 'string' && value.currency.toUpperCase() === 'USD' ? usd(value.amount) : null;
}
function track({kind,record:r,thread,id,env}) {
  if (kind !== 'provider-turn.updated' && kind !== 'provider-thread.updated') return;
  const session = kind === 'provider-thread.updated';
  const amount = usd(session ? r.contextUsage?.cost : (r.turnTokenUsage?.cost ?? r.tokenUsage?.cost ?? r.cost));
  const owner = id(session ? r.id : r.providerThreadId), turn = id(r.id);
  if (!amount || !owner || !turn) return;
  const key=(env||route().env||'')+'/'+thread;
  if (!threads.has(key)) threads.set(key,new Map());
  const groups=threads.get(key);
  if (!groups.has(owner)) groups.set(owner,{session:0,turns:new Map()});
  const group=groups.get(owner);
  if (session) group.session=Math.max(group.session,amount);
  else group.turns.set(turn,Math.max(group.turns.get(turn)||0,amount));
  if (route().thread === thread) schedulePaint();
}
function total(thread,env=route().env) {
  let sum=0;
  for (const g of threads.get((env||'')+'/'+thread)?.values() || []) {
    let turns=0; for (const cost of g.turns.values()) turns+=cost;
    sum+=Math.max(g.session,turns);
  }
  return sum || null;
}
bus.subscribe(track);
const money = n => n>0 && n<0.01 ? '< $0.01' : '$'+n.toLocaleString('en-US',{maximumFractionDigits:2});
function keyReading(it) {
  const m=it.metrics || {};
  if (it.id==='scrapedo' && Number.isFinite(m.remainingReq) && m.remainingReq>=0) {
    return {value:m.remainingReq.toLocaleString('ru-RU')+' запр.',fraction:m.maxReq>0 ? m.remainingReq/m.maxReq : null};
  }
  const left=m.remainingUsd ?? m.balanceUsd;
  if (Number.isFinite(left) && left>0) return {value:money(left),fraction:m.limitUsd>0 ? left/m.limitUsd : null};
  if (left==null && Number.isFinite(m.usedUsd) && m.usedUsd>0) return {value:'Расход '+money(m.usedUsd)};
  return null;
}
function countdown(reset,now) {
  const minutes=Math.ceil((reset-now)/60000);
  if (minutes<60) return minutes+' мин';
  const hours=Math.floor(minutes/60);
  if (hours>=24) return Math.floor(hours/24)+' д'+(hours%24?' '+hours%24+' ч':'');
  return hours+' ч'+(minutes%60?' '+minutes%60+' мин':'');
}
const style=node('style');style.textContent=`
.oly-budget-pill,.oly-budget-pop button{font:500 13px/1.3 Inter,system-ui,sans-serif;color:var(--budget-ink,var(--foreground));cursor:pointer}
.oly-budget-pill{position:relative;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;flex-shrink:0;background:var(--budget-paper,var(--background));border:1px solid var(--budget-line,var(--border));border-radius:2px}
.oly-budget-pill span{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.oly-budget-pill span:empty{display:none}.oly-budget-pill svg{width:15px;height:15px;flex:none}
.oly-budget-pill[data-low=true]::after{content:'';position:absolute;top:1px;right:1px;width:5px;height:5px;background:var(--budget-warning,#c18119);border-radius:50%}
.oly-budget-pop{position:fixed;inset:auto;margin:0;box-sizing:border-box;width:min(352px,calc(100vw - 16px));max-height:min(520px,calc(100vh - 58px));overflow:auto;overscroll-behavior:contain;padding:15px 16px 10px;background:var(--budget-paper,var(--card));color:var(--budget-text,var(--foreground));border:1px solid var(--budget-line,var(--border));border-radius:2px;z-index:10000;box-shadow:var(--budget-shadow,0 8px 28px #0003);font:13px/1.35 Inter,system-ui,sans-serif;font-variant-numeric:tabular-nums}
.oly-budget-pop h3{margin:0;color:var(--budget-ink,var(--foreground));font:var(--budget-heading,600 18px/1.3 Georgia,serif);letter-spacing:var(--budget-spacing,normal);text-transform:var(--budget-case,none)}
.oly-budget-head,.oly-budget-account,.oly-budget-window,.oly-budget-key,.oly-budget-cost{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.oly-budget-caption,.oly-budget-plan,.oly-budget-reset,.oly-budget-empty{color:var(--budget-muted,var(--muted-foreground));font-size:12px}
.oly-budget-group{padding:10px 0}.oly-budget-group+.oly-budget-group,.oly-budget-keys{border-top:1px solid var(--budget-line,var(--border))}
.oly-budget-account{justify-content:flex-start}.oly-budget-account b,.oly-budget-plan,.oly-budget-window span:first-child,.oly-budget-key span{min-width:0;overflow-wrap:anywhere}
.oly-budget-window{margin:6px 0 3px;gap:8px}.oly-budget-window strong{min-width:3ch;text-align:right}.oly-budget-reset{margin-left:auto;white-space:nowrap}
.oly-budget-pop progress{display:block;appearance:none;width:100%;height:3px;border:0;background:transparent}.oly-budget-pop progress::-webkit-progress-bar{background:var(--budget-track,var(--border))}.oly-budget-pop progress::-webkit-progress-value{background:var(--budget-ink,var(--primary))}.oly-budget-pop progress[data-low=true]::-webkit-progress-value{background:var(--budget-warning,#c18119)}
.oly-budget-keys{padding-top:5px}.oly-budget-pop button{background:transparent;border:0;padding:3px 0;min-height:28px;color:var(--budget-ink,var(--primary))}.oly-budget-pop button:hover{text-decoration:underline}
.oly-budget-key,.oly-budget-cost{padding:3px 0}.oly-budget-key strong{font-weight:500;white-space:nowrap}.oly-budget-key+progress{margin-bottom:4px}.oly-budget-cost{font-size:12px}.oly-budget-empty{margin:4px 0 8px}
.oly-budget-pop:focus{outline:none}.oly-budget-pop button:focus-visible,.oly-budget-pill:focus-visible{outline:2px solid var(--budget-ink,var(--primary));outline-offset:2px}`;
(document.head||document.documentElement).append(style);

let pill,pop,body,keyList,keysButton,balances=[],error='',busy=false,lastRead=0,paintQueued=false,keysUntil=0,lastRoute='';
function schedulePaint(){if(!paintQueued){paintQueued=true;requestAnimationFrame(()=>{paintQueued=false;paint()})}}
async function load(){
  if(busy || Date.now()-lastRead<60000) return;
  busy=true;error='';
  try {
    const res=await fetch('http://127.0.0.1:4522/api/balances/saved',{signal:AbortSignal.timeout(5000)});
    if(!res.ok) throw Error();
    const data=await res.json(); if(!Array.isArray(data.items)) throw Error();
    balances=data.items; lastRead=Date.now();
  } catch { error='Остатки ключей недоступны'; }
  finally {busy=false;schedulePaint()}
}
function bar(parent,name,fraction) {
  const el=node('progress');el.max=100;el.value=Math.max(0,Math.min(100,100*fraction));
  el.dataset.low=String(fraction<0.1);el.setAttribute('aria-label','Остаток · '+name);parent.append(el);
}
function paint(){
  if(!pill) return;
  const now=Date.now(),groups=subscriptions(now);
  let tight;
  for(const g of groups) for(const w of g.windows) if(!tight || w.left<tight.window.left) tight={group:g,window:w};
  const cost=total(route().thread);
  /* Только иконка кошелька (пользователь, 2026-11-18): остаток и расход — в подсказке, точка — когда лимит на исходе. */
  const value=tight ? tight.group.name+' · '+tight.window.label+' · осталось '+tight.window.left+'%' : cost ? 'расход треда '+money(cost) : '';
  pill.dataset.low=String(tight ? tight.window.left<10 : balances.some(it=>(keyReading(it)?.fraction ?? 1)<0.1));
  if(pill.lastChild.textContent)pill.lastChild.textContent='';
  pill.title='Бюджет и лимиты'+(value?' · '+value:'');
  pill.setAttribute('aria-label',pill.title);
  if(!pop)return;
  body.replaceChildren();keyList.replaceChildren();
  if(groups.length){
    const head=node('div','oly-budget-head');
    head.append(node('h3','','Подписки'),node('span','oly-budget-caption','Осталось'));body.append(head);
    const counts=new Map();
    for(const g of groups){
      const box=node('section','oly-budget-group'),label=node('div','oly-budget-account');
      let name=g.name;
      if(groups.some(other=>other!==g && other.name===g.name && other.plan===g.plan)){
        const key=JSON.stringify([g.name,g.plan]);counts.set(key,(counts.get(key)||0)+1);name+=' · '+counts.get(key);
      }
      label.append(node('b','',name));
      if(g.plan && g.plan!==g.name) label.append(node('span','oly-budget-plan',g.plan));
      box.append(label);
      for(const w of g.windows){
        const row=node('div','oly-budget-window');row.append(node('span','',w.label));
        const reset=node('span','oly-budget-reset');
        if(Number.isFinite(w.reset)){reset.textContent='сброс через '+countdown(w.reset,now);reset.title=new Date(w.reset).toLocaleString('ru-RU')}
        row.append(reset,node('strong','',w.left+'%'));box.append(row);bar(box,name+' · '+w.label,w.left/100);
      }
      body.append(box);
    }
  }
  if(cost){
    const row=node('div','oly-budget-cost');row.append(node('span','','В этом чате'),node('span','',money(cost)));body.append(row);
  }
  for(const it of balances){
    const reading=keyReading(it);if(!reading)continue;
    const row=node('div','oly-budget-key');row.append(node('span','',it.name),node('strong','',reading.value));
    if(it.at) row.title='По данным на '+new Date(it.at).toLocaleString('ru-RU');
    keyList.append(row);if(reading.fraction!=null)bar(keyList,it.name,reading.fraction);
  }
  if(error)keyList.append(node('div','oly-budget-empty',error));
  if(!body.childElementCount && !keyList.childElementCount && !busy)keyList.append(node('div','oly-budget-empty','Пока нет данных о лимитах'));
  keysButton.parentElement.style.borderTopWidth=body.childElementCount?'':'0';
  position();
}
function position(){if(!pop||!pill?.isConnected)return;const r=pill.getBoundingClientRect(),above=r.top-pop.offsetHeight-6;
  pop.style.left=Math.max(8,Math.min(r.left,innerWidth-pop.offsetWidth-8))+'px';
  pop.style.top=Math.max(8,Math.min(innerHeight-pop.offsetHeight-8,above>=8?above:r.bottom+6))+'px'}
function close(focus=false){if(!pop)return;pop.remove();pop=null;pill?.setAttribute('aria-expanded','false');if(focus)pill?.focus()}
function openKeys(){
  close();keysUntil=Date.now()+5000;
  const router=globalThis.__TSR_ROUTER__;
  if(router)void router.navigate({to:'/settings/providers'}).then(mount);
  else if(location.hash.startsWith('#/'))location.hash='/settings/providers';
  else location.assign('/settings/providers');
}
function open(){
  if(pop){close(true);return}
  pop=node('section','oly-budget-pop');pop.setAttribute('role','dialog');pop.setAttribute('aria-label','Бюджет и лимиты');pop.id='oly-budget-popup';
  body=node('div');const keys=node('section','oly-budget-keys');keyList=node('div');
  keysButton=node('button','','API-ключи ↗');keysButton.type='button';keysButton.onclick=openKeys;
  keysButton.setAttribute('aria-label','Настройки API-ключей');keys.append(keysButton,keyList);
  pop.append(body,keys);document.body.append(pop);
  pop.tabIndex=-1;pill.setAttribute('aria-expanded','true');void load();paint();pop.focus({preventScroll:true});
}
function mount(){
  if(keysUntil>Date.now() && document.querySelector('[data-oly-ik-nav]')){keysUntil=0;globalThis.__olyIntegrations?.open()}
  const path=location.pathname+location.hash;if(path!==lastRoute){lastRoute=path;close();schedulePaint()}
  const host=document.querySelector('[data-slot=composer-host]');
  const anchor=host?.querySelector('.oly-speed')||host?.querySelector('.oly-plan,button[data-composer-shortcut~="composer.effort"]');
  if(!anchor){if(!pill?.isConnected)close();return}
  if(!pill){pill=node('button','oly-budget-pill');pill.type='button';pill.setAttribute('aria-haspopup','dialog');pill.setAttribute('aria-controls','oly-budget-popup');pill.setAttribute('aria-expanded','false');
    pill.innerHTML='<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="1.7"><path d="M4 7h15a1 1 0 0 1 1 1v11H4a1 1 0 0 1-1-1V6a2 2 0 0 1 2-2h12v3"/><path d="M20 11h-5v4h5"/></svg><span></span>';pill.onclick=open}
  if(anchor.nextElementSibling!==pill){anchor.after(pill);paint()}
}
document.addEventListener('pointerdown',e=>{if(pop&&!pop.contains(e.target)&&!pill.contains(e.target))close()},true);
document.addEventListener('keydown',e=>{if(pop&&e.key==='Escape'){e.preventDefault();close(true)}});
addEventListener('resize',position);document.addEventListener('scroll',position,true);
setInterval(()=>{if(!document.hidden && pill?.isConnected && environments.size)schedulePaint()},30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedulePaint()});
globalThis.__olyBudget={total};onMount(mount);
}catch(e){console.warn('oly budget',e)}})();

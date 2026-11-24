;(()=>{try{
/* 25-bg-tasks: «Фоновые задачи» in the thread details card ([data-thread-details-card]).
   Data (read passively from the app WebSocket, no polling):
   - orchestration.subscribeShell chunks: {kind:'snapshot',snapshot:{threads}} / {kind:'thread.updated',thread} —
     thread.pendingBackgroundTasks [{taskId,kind:'command'|'monitor'|'subagent'|'background_task',description,awaited,childThreadId}],
     thread.pullRequests[].watch (CI), thread.lineage (subagent children), status, activeRunId, activityRunStatus;
   - orchestration.subscribeThread chunks (thread opened in the app): {kind:'snapshot',projection:{providerThreads,turnItems}},
     {kind:'event',event:{type:'provider-thread.updated'|'turn-item.updated',payload}} — tasks with `command`/`itemId`
     also while a run is active (the shell list is empty then), command items (input/output/exitCode/startedAt);
   - orchestration.subscribeCommandOutput chunks {kind,text,running} (when the user opens an output) — port / tunnel URL.
   Request ids → threadId/itemId come from outgoing frames ({_tag:'Request',id,tag,payload}).
   Classification rules: RULES below (one place). The section is our own <section> next to React's sections. */
if(globalThis.__olyBgTasks)return;
const KEEP_MS=5*60e3;          // finished tasks stay visible this long
const PRW='pull-request-watch:';
const ACTIVE_RUN=new Set(['preparing','queued','starting','running']);
const CHILD={preparing:'run',queued:'run',starting:'run',running:'run',waiting:'wait',completed:'ok',interrupted:'err',failed:'err',cancelled:'err',rolled_back:'err'};
const STATE_TEXT={run:'идёт',wait:'ждёт',ok:'готово',err:'ошибка'};
const str=v=>typeof v==='string'?v:'';
const oneLine=s=>str(s).replace(/\s+/g,' ').trim();

/* ---------- 1. Port / URL extraction ---------- */
const okPort=n=>{n=+n;return n>0&&n<65536?String(n):''};
const PORT_CMD=[
 /(?:^|\s)(?:--port|--http-port|--listen|-p)(?:=|\s+)(?:[\w.\[\]:]*:)?(\d{2,5})\b/i,
 /\bPORT\s*=\s*["']?(\d{2,5})\b/,
 /\bhttp\.server\s+(\d{2,5})\b/,
 /\brunserver\s+(?:[\w.]+:)?(\d{2,5})\b/,
 /\bphp\s+-S\s+[\w.\[\]:]+:(\d{2,5})\b/,
 /--(?:bind|host)(?:=|\s+)[\w.\[\]]*:(\d{2,5})\b/,
 /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|[\w-]+(?:\.[\w-]+)*):(\d{2,5})\b/i
];
const PORT_OUT=[
 /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|[\w-]+(?:\.[\w-]+)*):(\d{2,5})\b/i,
 /\b(?:listening|running|available|started|serving|server)\b[^\n]{0,60}?\bport\s+(\d{2,5})\b/i,
 /\bport\s+(\d{2,5})\b/i
];
function findPort(text,list){const s=str(text);if(!s)return'';for(const re of list){const m=re.exec(s);if(m){const p=okPort(m[1]);if(p)return p}}return''}
const TUNNEL_URL=/\bhttps:\/\/[a-z0-9-]+\.(?:trycloudflare\.com|ngrok(?:-free)?\.(?:app|io|dev)|loca\.lt)\b/i;
const findTunnel=t=>{const m=TUNNEL_URL.exec(str(t));return m?m[0]:''};

/* ---------- 2. Classification rules (first match wins; add new kinds here) ----------
   t = {kind, text (command or description), port, url, ci, agent}. `label(t)` is the row title. */
const SERVER_RE=/\b(?:vite(?:\s+(?:dev|preview|serve))?|next\s+(?:dev|start)|nuxt(?:i)?\s+dev|astro\s+(?:dev|preview)|remix\s+dev|svelte-kit\s+dev|webpack(?:-dev-server|\s+serve)|http-server|live-server|npx\s+serve|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve|preview)(?::[\w-]+)?|python[\d.]*\s+-m\s+http\.server|uvicorn|gunicorn|hypercorn|flask\s+run|manage\.py\s+runserver|rails\s+s(?:erver)?|php\s+-S|hugo\s+server|jekyll\s+serve|wrangler\s+dev|deno\s+task\s+(?:dev|start)|docusaurus\s+start|storybook\s+dev|ng\s+serve|expo\s+start|bun\s+--hot|nodemon)\b/i;
const TEST_RE=/\b(?:tests?|jest|vitest|pytest|mocha|playwright\s+test|node\s+--test|cargo\s+test|go\s+test|dotnet\s+test|phpunit|rspec|unittest)\b/i;
const BUILD_RE=/\b(?:build|compile|tsc|cargo\s+(?:build|check)|go\s+build|make|cmake|gradle|mvn|msbuild|lint|typecheck|eslint|electron-builder|pyinstaller)\b/i;
const RULES=[
 {id:'agent',  test:t=>t.agent||t.kind==='subagent',                                      label:()=>'Субагент'},
 {id:'ci',     test:t=>t.ci||/\bgh\s+(?:run\s+watch|pr\s+checks)\b|watch_pull_request|\bgh\s+run\s+view\b[^\n]*--watch|\bwait(?:ing)?\s+for\s+(?:ci|checks)\b|Watching pull request/i.test(t.text),
                                                                                           label:()=>'Ожидание CI'},
 {id:'tunnel', test:t=>/\bcloudflared\b|trycloudflare|\bngrok\b|\blocaltunnel\b|\blt\s+--port\b/i.test(t.text)||/trycloudflare|ngrok/i.test(t.url),
                                                                                           label:t=>/ngrok/i.test(t.text+' '+t.url)?'Туннель ngrok':/localtunnel|\blt\s/i.test(t.text)?'Туннель':'Cloudflare Tunnel'},
 {id:'server', test:t=>SERVER_RE.test(t.text),                                             label:t=>t.port?'Сервер на порту :'+t.port:'Сервер'},
 {id:'monitor',test:t=>t.kind==='monitor'||/\btail\s+-[fF]\b|Get-Content\b[^\n]*-Wait\b|\bwatch\s+-n\b|\buntil\b[^\n]*\bsleep\b/i.test(t.text),
                                                                                           label:()=>'Мониторинг'},
 {id:'build',  test:t=>TEST_RE.test(t.text)||BUILD_RE.test(t.text),                        label:t=>TEST_RE.test(t.text)?'Тесты':'Сборка'},
 {id:'command',test:t=>t.kind==='command',                                                 label:()=>'Команда'},
 {id:'task',   test:()=>true,                                                              label:()=>'Фоновая задача'}
];
function classify(t){
 const x={kind:str(t.kind),text:str(t.text),port:str(t.port),url:str(t.url),ci:!!t.ci,agent:!!t.agent};
 for(const r of RULES)if(r.test(x))return{type:r.id,label:r.label(x)};
 return{type:'task',label:'Фоновая задача'};
}

/* ---------- 3. Store: WebSocket frames → per-thread task items ---------- */
function memorySeen(){const m=new Map();return{get:k=>m.get(k),set:(k,v)=>{m.set(k,v)}}}
function storageSeen(){
 const KEY='oly-bgtasks-seen';let m={};
 try{m=JSON.parse(localStorage.getItem(KEY)||'{}')||{}}catch(_){m={}}
 let t=0;const save=()=>{t=0;try{const now=Date.now(),e=Object.entries(m).filter(([,v])=>now-v<2*864e5).sort((a,b)=>b[1]-a[1]).slice(0,300);
  m=Object.fromEntries(e);localStorage.setItem(KEY,JSON.stringify(m))}catch(_){}};
 return{get:k=>m[k],set:(k,v)=>{m[k]=v;if(!t)t=setTimeout(save,2000)}};
}
function createStore(opts={}){
 const now=opts.now||Date.now;const seen=opts.seen||memorySeen();
 const shells=new Map();   // threadId -> minimal shell
 const kids=new Map();     // parentThreadId -> Set(child threadIds)
 const threads=new Map();  // threadId -> {prov:Map, provKnown, cmds:Map, items:Map}
 const req=new Map();      // socketUrl#requestId -> {tag, threadId, itemId}
 const subs=new Set();let version=0;
 const T=id=>{let t=threads.get(id);if(!t){t={prov:new Map(),provKnown:false,cmds:new Map(),items:new Map()};threads.set(id,t)}return t};
 const rkey=(meta,id)=>(meta&&meta.url||'')+'#'+id;
 function tasksOf(list){
  const out=[];if(!Array.isArray(list))return out;
  for(const x of list){if(!x||typeof x!=='object'||!str(x.taskId))continue;
   out.push({taskId:x.taskId,kind:str(x.kind)||'background_task',description:oneLine(x.description),command:str(x.command),
    awaited:x.awaited===true,childThreadId:str(x.childThreadId),itemId:str(x.itemId),nativeItemId:str(x.nativeItemId)})}
  return out;
 }
 function shell(th,touched){
  const id=str(th.id)||str(th.threadId);if(!id)return;
  const lin=th.lineage&&typeof th.lineage==='object'?th.lineage:{};
  const prs=[];for(const p of Array.isArray(th.pullRequests)?th.pullRequests:[]){if(!p||typeof p!=='object')continue;
   prs.push({key:str(p.host).toLowerCase()+'/'+str(p.repository).toLowerCase()+'#'+p.number,number:p.number,url:str(p.url),
    state:p.snapshot&&p.snapshot.state,watch:p.watch&&typeof p.watch==='object'?p.watch:null,ended:p.endedWatch&&typeof p.endedWatch==='object'?p.endedWatch:null,
    dismissed:p.source==='stack-dismissed'})}
  const prev=shells.get(id);
  const s={id,title:oneLine(th.title),status:str(th.status),activity:str(th.activityRunStatus),activeRunId:th.activeRunId??null,
   parent:str(lin.parentThreadId)||str(th.parentThreadId),rel:str(lin.relationshipToParent)||str(th.relationshipToParent),
   started:Date.parse(th.activityRunStartedAt||th.latestRunStartedAt||'')||0,completed:Date.parse(th.latestRunCompletedAt||'')||0,
   blocked:th.blockedOnThreadWait===true,pending:tasksOf(th.pendingBackgroundTasks),prs,model:str(th.modelSelection&&th.modelSelection.model),
   wasActive:!!(prev&&prev.wasActive)};
  const st=CHILD[s.status]||CHILD[s.activity];
  if(st==='run'||st==='wait'||s.activeRunId!=null||s.pending.length)s.wasActive=true;
  if(prev&&prev.parent&&prev.parent!==s.parent)kids.get(prev.parent)?.delete(id);
  if(s.parent){let k=kids.get(s.parent);if(!k)kids.set(s.parent,k=new Set());k.add(id)}
  shells.set(id,s);touched.add(id);if(s.parent)touched.add(s.parent);
 }
 function cmdItem(t,it){
  if(!it||typeof it!=='object'||it.type!=='command_execution')return;
  const ids=[str(it.id),it.nativeItemRef&&str(it.nativeItemRef.nativeId)].filter(Boolean);if(!ids.length)return;
  const old=t.cmds.get(ids[0])||{};
  const out=str(it.output);
  const c={input:str(it.input)||old.input||'',status:str(it.status)||old.status,exitCode:typeof it.exitCode==='number'?it.exitCode:old.exitCode,
   fail:it.outputIndicatesFailure===true||old.fail===true,started:Date.parse(it.startedAt||'')||old.started||0,
   port:findPort(out,PORT_OUT)||old.port||'',url:findTunnel(out)||old.url||''};
  for(const k of ids)t.cmds.set(k,c);
  if(t.cmds.size>400){const k=t.cmds.keys().next().value;t.cmds.delete(k)}
 }
 function projection(p,reqThread,touched){
  const id=str(p.thread&&p.thread.id)||reqThread;if(!id)return;const t=T(id);
  if(Array.isArray(p.providerThreads)){t.prov.clear();for(const pt of p.providerThreads)if(pt&&typeof pt==='object')t.prov.set(str(pt.id)||'?',tasksOf(pt.pendingBackgroundTasks));t.provKnown=true}
  if(Array.isArray(p.turnItems))for(const it of p.turnItems)cmdItem(t,it);
  touched.add(id);
 }
 function event(e,reqThread,touched){
  const id=reqThread||str(e.threadId);if(!id||!e.payload||typeof e.payload!=='object')return;
  if(e.type==='provider-thread.updated'){const t=T(id);t.prov.set(str(e.payload.id)||'?',tasksOf(e.payload.pendingBackgroundTasks));t.provKnown=true;touched.add(id)}
  else if(e.type==='turn-item.updated'&&e.payload.type==='command_execution'){cmdItem(T(id),e.payload);touched.add(id)}
 }
 function output(r,v,touched){
  if(!r.threadId||!r.itemId)return;const t=T(r.threadId);const c=t.cmds.get(r.itemId)||{};
  const tail=((v.kind==='replace'?'':c.tail||'')+v.text).slice(-4096);
  const n={...c,tail,port:findPort(tail,PORT_OUT)||c.port||'',url:findTunnel(tail)||c.url||''};
  t.cmds.set(r.itemId,n);touched.add(r.threadId);
 }
 function ingestOut(msg,meta){
  if(!msg||typeof msg!=='object')return;
  if(msg._tag==='Request'&&typeof msg.tag==='string'){
   const p=msg.payload&&typeof msg.payload==='object'?msg.payload:{};
   if(msg.tag==='orchestration.subscribeThread')req.set(rkey(meta,msg.id),{tag:'thread',threadId:str(p.threadId)});
   else if(msg.tag==='orchestration.subscribeCommandOutput')req.set(rkey(meta,msg.id),{tag:'out',threadId:str(p.threadId),itemId:str(p.itemId)});
  }else if(msg._tag==='Interrupt')req.delete(rkey(meta,msg.requestId));
 }
 function ingestIn(msg,meta){
  if(Array.isArray(msg)){for(const m of msg)ingestIn(m,meta);return}
  if(!msg||typeof msg!=='object')return;
  if(msg._tag==='Exit'){req.delete(rkey(meta,msg.requestId));return}
  if(msg._tag!=='Chunk'||!Array.isArray(msg.values))return;
  const r=req.get(rkey(meta,msg.requestId));const touched=new Set();
  for(const v of msg.values){if(!v||typeof v!=='object')continue;
   if(r&&r.tag==='out'){if(typeof v.text==='string')output(r,v,touched);continue}
   if(v.kind==='snapshot'){
    if(v.snapshot&&Array.isArray(v.snapshot.threads))for(const th of v.snapshot.threads)if(th&&typeof th==='object')shell(th,touched);
    if(v.projection&&typeof v.projection==='object')projection(v.projection,r&&r.threadId,touched);
   }else if(v.kind==='thread.updated'&&v.thread&&typeof v.thread==='object')shell(v.thread,touched);
   else if(v.kind==='event'&&v.event&&typeof v.event==='object')event(v.event,r&&r.threadId,touched);
  }
  if(touched.size){const tm=now();for(const id of touched)recompute(id,tm);version++;for(const f of subs)try{f(touched)}catch(e){console.warn('oly bg-tasks sub',e)}}
 }
 // Merge sources into items; a task that leaves every source becomes «готово»/«ошибка» for KEEP_MS.
 function recompute(id,tm){
  const sh=shells.get(id),ks=kids.get(id);
  // Nothing to show and nothing tracked: do not allocate state for every thread of the shell snapshot.
  if(!threads.has(id)&&!(sh&&(sh.pending.length||sh.prs.some(p=>p.watch)))&&!(ks&&ks.size))return;
  const t=T(id);
  const runActive=!!sh&&(sh.activeRunId!=null||ACTIVE_RUN.has(sh.activity));
  const present=new Map();
  for(const list of t.prov.values())for(const x of list)if(!present.has(x.taskId))present.set(x.taskId,x);
  if(sh&&!runActive)for(const x of sh.pending)if(!present.has(x.taskId))present.set(x.taskId,x);
  // The shell list is empty while a run is active: without the thread stream we cannot tell finished from hidden.
  const frozen=runActive&&!t.provKnown;
  const live=new Set();
  for(const x of present.values()){
   if(x.taskId.startsWith(PRW))continue;            // CI comes from pullRequests[].watch (richer)
   const key=x.kind==='subagent'&&x.childThreadId?'agent:'+x.childThreadId:x.taskId;live.add(key);
   const old=t.items.get(key);
   const start=old&&old.start||seen.get(key)||tm;if(!seen.get(key))seen.set(key,start);
   t.items.set(key,{...(old||{}),...x,key,agent:x.kind==='subagent',start,done:0,end:0,final:''});
  }
  if(sh)for(const p of sh.prs){
   if(p.dismissed||p.state==='merged')continue;const key='ci:'+p.key;
   if(p.watch){live.add(key);const old=t.items.get(key);const ws=Date.parse(p.watch.startedAt||'')||0;
    const start=ws||old&&old.start||seen.get(key)||tm;if(!seen.get(key))seen.set(key,start);
    t.items.set(key,{key,taskId:key,kind:'monitor',ci:true,pr:p,description:'PR #'+p.number,start,done:0,end:0,final:''})}
   else if(p.ended&&t.items.has(key)){const it=t.items.get(key);if(!it.done){it.pr=p;it.done=tm;it.end=tm;it.final=ciState(p.ended,true)}}
  }
  for(const cid of ks||[]){                    // subagent children seen running in this session
   const s=shells.get(cid);if(!s||s.parent!==id||s.rel!=='subagent'||!s.wasActive)continue;
   const key='agent:'+s.id,st=CHILD[s.activity]||CHILD[s.status];
   if(st==='run'||st==='wait'){if(!t.items.has(key)||t.items.get(key).done){live.add(key);
     const start=s.started||seen.get(key)||tm;if(!seen.get(key))seen.set(key,start);
     t.items.set(key,{key,taskId:key,kind:'subagent',agent:true,childThreadId:s.id,start,done:0,end:0,final:''})}else live.add(key)}
   else if(!t.items.has(key)&&s.completed&&tm-s.completed<KEEP_MS)
    t.items.set(key,{key,taskId:key,kind:'subagent',agent:true,childThreadId:s.id,start:s.started||s.completed,done:s.completed,end:s.completed,final:st||'ok'});
  }
  for(const [key,it]of t.items){
   if(live.has(key))continue;
   if(it.done){if(tm-it.done>KEEP_MS)t.items.delete(key);continue}
   const c=it.agent?shells.get(it.childThreadId):null,cst=c&&(CHILD[c.status]||'');
   if(frozen&&!it.ci&&!(it.agent&&(cst==='ok'||cst==='err')))continue;
   it.done=tm;it.end=c&&c.completed>it.start?c.completed:tm;
   it.final=it.agent?(CHILD[c&&c.status]==='err'?'err':'ok'):cmdFinal(t,it);
  }
 }
 function cmdFinal(t,it){const c=cmdOf(t,it);return c&&(c.fail||typeof c.exitCode==='number'&&c.exitCode!==0||c.status==='failed')?'err':'ok'}
 const cmdOf=(t,it)=>t.cmds.get(it.itemId)||t.cmds.get(it.nativeItemId)||t.cmds.get(it.taskId)||null;
 function ciState(w,ended){
  const fail=Array.isArray(w.failedChecks)&&w.failedChecks.length;
  if(fail)return'err';if(w.passed===true)return'ok';
  if(Array.isArray(w.awaitingApproval)&&w.awaitingApproval.length)return'wait';
  return ended?'ok':'run';
 }
 // View model for one thread.
 function view(id,tm=now()){
  const t=threads.get(id);if(!t)return{rows:[],agents:null,active:0};
  for(const [k,it]of t.items)if(it.done&&tm-it.done>KEEP_MS)t.items.delete(k);
  const rows=[],agents=[];
  for(const it of t.items.values()){
   if(it.agent){const s=shells.get(it.childThreadId);
    const st=it.done?it.final:(CHILD[s&&s.activity]||CHILD[s&&s.status]||'run');
    const name=s&&s.title||it.description||'Субагент',desc=oneLine(it.description);
    const detail=[modelName(s&&s.model),desc&&desc!==name?desc:''].filter(Boolean).join(' · ');
    agents.push({key:it.key,type:'agent',label:name,detail,title:name+(detail?'\n'+detail:''),state:st,
     start:s&&s.started||it.start,end:it.done?it.end:(st==='ok'||st==='err')&&s&&s.completed||0,thread:it.childThreadId});
    continue}
   const c=it.ci?null:cmdOf(t,it);
   const text=it.command||c&&c.input||it.description||'';
   const port=findPort(text,PORT_CMD)||c&&c.port||'';
   const url=findTunnel(text)||c&&c.url||'';
   const k=classify({kind:it.kind,text,port,url,ci:it.ci});
   let state=it.done?it.final:'run',detail=oneLine(it.command||c&&c.input||it.description),href='',title=oneLine(text)||k.label;
   if(it.ci){const w=it.pr.watch||it.pr.ended||{};if(!it.done)state=ciState(w,false);
    const pass=(Array.isArray(w.passedChecks)?w.passedChecks.length:0),fail=(Array.isArray(w.failedChecks)?w.failedChecks.length:0);
    detail='PR #'+it.pr.number+(fail?' · не прошло: '+fail:pass?' · прошло: '+pass:'');href=it.pr.url;title=detail+(it.pr.url?' — '+it.pr.url:'');
    if(fail)title+='\nНе прошли: '+w.failedChecks.join(', ')}
   else if(!it.done&&(k.type==='monitor'||it.kind==='monitor'))state='wait';
   if(k.type==='tunnel'&&url){href=url;detail=url.replace(/^https:\/\//,'')}
   else if(k.type==='server'&&port)href='http://localhost:'+port;
   const start=c&&c.started&&c.started<it.start?c.started:it.start;
   rows.push({key:it.key,type:k.type,label:k.label,detail,title,state,start,end:it.done?it.end:0,href,reveal:[it.itemId,it.nativeItemId,it.taskId].filter(Boolean)});
  }
  const order={run:0,wait:1,err:2,ok:3};
  rows.sort((a,b)=>order[a.state]-order[b.state]||a.start-b.start);
  agents.sort((a,b)=>order[a.state]-order[b.state]||a.start-b.start);
  let group=null;
  if(agents.length){const sh=shells.get(id);const done=agents.filter(a=>a.state==='ok').length,err=agents.filter(a=>a.state==='err').length;
   const waiting=!!sh&&(sh.blocked||sh.status==='waiting'||sh.activity==='waiting'||agents.some(a=>a.state!=='ok'&&a.state!=='err'));
   const allDone=done+err===agents.length;
   group={key:'agents',type:'agents',label:allDone?'Субагенты':waiting?'Ожидание субагентов':'Субагенты',total:agents.length,done,err,
    state:allDone?(err?'err':'ok'):agents.some(a=>a.state==='run')?'run':'wait',items:agents,
    start:Math.min(...agents.map(a=>a.start||tm)),end:allDone?Math.max(...agents.map(a=>a.end||0)):0}}
  const active=rows.filter(r=>r.state==='run'||r.state==='wait').length+agents.filter(a=>a.state==='run'||a.state==='wait').length;
  return{rows,agents:group,active};
 }
 return{ingestIn,ingestOut,view,classify,subscribe:f=>{subs.add(f);return()=>subs.delete(f)},get version(){return version},_shells:shells,_threads:threads,_req:req};
}

/* ---------- 4. Rendering (one HTML renderer: DOM and previews use the same markup) ---------- */
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const P={
 agent:'<circle cx="9" cy="7" r="3"/><path d="M3 20v-1a6 6 0 0 1 12 0v1"/><path d="M16 4.5a3 3 0 0 1 0 5"/><path d="M21 20v-1a5 5 0 0 0-3-4.6"/>',
 agents:'<circle cx="9" cy="7" r="3"/><path d="M3 20v-1a6 6 0 0 1 12 0v1"/><path d="M16 4.5a3 3 0 0 1 0 5"/><path d="M21 20v-1a5 5 0 0 0-3-4.6"/>',
 ci:'<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M6 8.5v7"/><circle cx="18" cy="18" r="2.5"/><path d="M18 15.5V9a3 3 0 0 0-3-3h-4"/><path d="m13 3-3 3 3 3"/>',
 server:'<rect x="3" y="4" width="18" height="7" rx="1"/><rect x="3" y="13" width="18" height="7" rx="1"/><path d="M7 7.5h.01M7 16.5h.01"/>',
 tunnel:'<path d="M7 18a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.5 1.5A4 4 0 0 1 17.5 18Z"/><path d="m10 13 2 2 2-2"/>',
 build:'<path d="M14.5 6.5 18 3l3 3-3.5 3.5"/><path d="m15 9-9.5 9.5a2.1 2.1 0 0 1-3-3L12 6"/>',
 monitor:'<path d="M3 12h4l2-6 4 12 2-6h6"/>',
 command:'<path d="m5 7 5 5-5 5"/><path d="M12 17h7"/>',
 task:'<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>'
};
const icon=t=>'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(P[t]||P.task)+'</svg>';
function elapsed(ms){
 const s=Math.max(0,Math.floor(ms/1000));if(s<60)return s+' с';
 const m=Math.floor(s/60);if(m<60)return m+' мин';
 const h=Math.floor(m/60),mm=m%60;return h+' ч'+(mm?' '+mm+' мин':'');
}
const timeEl=(r,tm)=>r.start?'<time class="oly-bg-t" data-since="'+r.start+'"'+(r.end?' data-until="'+r.end+'"':'')+'>'+esc(elapsed((r.end||tm)-r.start))+'</time>':'<span class="oly-bg-t"></span>';
// «claude-opus-5-5» → «Opus 5.5», «gpt-5.5-codex» → «GPT-5.5 codex»; anything else as is.
function modelName(id){id=str(id);if(!id)return'';let m=/^claude-(opus|sonnet|haiku|fable)-(\d+)(?:[-.](\d+))?/i.exec(id);
 if(m)return m[1][0].toUpperCase()+m[1].slice(1).toLowerCase()+' '+m[2]+(m[3]?'.'+m[3]:'');
 if((m=/^gpt-?(.+)$/i.exec(id)))return'GPT-'+m[1].replace(/-/g,' ');
 return id.length>24?id.slice(0,23)+'…':id}
const stateEl=s=>'<span class="oly-bg-st" data-state="'+s+'">'+STATE_TEXT[s]+'</span>';
// Title gets the full width of the narrow card; details, state and elapsed time share the line under it.
const txtHTML=(label,detail,r,tm)=>'<span class="oly-bg-txt"><span class="oly-bg-name">'+esc(label)+'</span><span class="oly-bg-meta"><span class="oly-bg-det">'+esc(detail||'')+'</span>'+stateEl(r.state)+timeEl(r,tm)+'</span></span>';
function rowHTML(r,tm){
 const link=r.href?'<a class="oly-bg-link" href="'+esc(r.href)+'" target="_blank" rel="noopener noreferrer" title="'+esc('Открыть '+r.href)+'" aria-label="'+esc('Открыть '+r.href)+'">↗</a>':'';
 return '<li class="oly-bg-row" data-type="'+r.type+'" data-state="'+r.state+'">'
  +'<button type="button" class="oly-bg-main" data-oly-bg-act="reveal" data-oly-bg-ids="'+esc(r.reveal.join('\n'))+'" title="'+esc(r.title)+'">'
  +'<span class="oly-bg-ic">'+icon(r.type)+'</span>'+txtHTML(r.label,r.detail&&r.detail!==r.label?r.detail:'',r,tm)+'</button>'
  +link+'</li>';
}
function groupHTML(g,tm){
 const pct=Math.round(100*(g.done+g.err)/g.total);
 let h='<li class="oly-bg-group" data-type="agents" data-state="'+g.state+'">'
  +'<div class="oly-bg-ghead"><span class="oly-bg-ic">'+icon('agents')+'</span><span class="oly-bg-name">'+esc(g.label)+' <b>'+g.total+'</b></span>'
  +'<span class="oly-bg-prog" role="progressbar" aria-label="Готово субагентов" aria-valuemin="0" aria-valuemax="'+g.total+'" aria-valuenow="'+g.done+'" title="'+esc('Готово '+g.done+' из '+g.total+(g.err?', с ошибкой '+g.err:''))+'">'
  +'<span>'+g.done+'/'+g.total+'</span></span>'
  +timeEl(g,tm)+'</div><i class="oly-bg-bar oly-bg-gbar" aria-hidden="true"><i style="width:'+pct+'%"'+(g.err?' data-err=""':'')+'></i></i><ul class="oly-bg-sub">';
 for(const a of g.items)h+='<li class="oly-bg-row" data-type="agent" data-state="'+a.state+'">'
  +'<button type="button" class="oly-bg-main" data-oly-bg-act="thread" data-oly-bg-thread="'+esc(a.thread)+'" title="'+esc('Открыть тред: '+a.title)+'">'
  +'<span class="oly-bg-dot" aria-hidden="true"></span>'+txtHTML(a.label,a.detail,a,tm)+'</button></li>';
 return h+'</ul></li>';
}
function renderHTML(vm,tm=Date.now()){
 if(!vm||(!vm.rows.length&&!vm.agents))return'';
 let h='<div class="oly-bg-head"><h3>Фоновые задачи</h3>'+(vm.active?'<span class="oly-bg-sum">'+vm.active+' в работе</span>':'')+'</div><ul class="oly-bg-list">';
 if(vm.agents)h+=groupHTML(vm.agents,tm);
 for(const r of vm.rows)h+=rowHTML(r,tm);
 return h+'</ul>';
}
// Structure key without the ticking time text (re-render only when something besides elapsed changes).
const shape=html=>html.replace(/(<time [^>]*>)[^<]*(<\/time>)/g,'$1$2');

const api={createStore,classify,findPort,findTunnel,renderHTML,elapsed,modelName,RULES,PORT_CMD,PORT_OUT,KEEP_MS};
globalThis.__olyBgTasks=api;
if(typeof document==='undefined'||typeof MutationObserver==='undefined')return;

/* ---------- 5. DOM: section in the thread details card ---------- */
const store=createStore({seen:storageSeen()});api.store=store;
const core=globalThis.__olyCore;
const MARKERS=['pendingBackgroundTasks','provider-thread.updated','command_execution','"truncated"'];
if(core&&core.onWsFrame){core.onWsFrame((m,meta)=>store.ingestIn(m,meta),{contains:MARKERS});
 if(core.onWsSend)core.onWsSend((m,meta)=>store.ingestOut(m,meta),{contains:['orchestration.subscribeThread','orchestration.subscribeCommandOutput','"Interrupt"']})}
else if(globalThis.WebSocket&&!globalThis.WebSocket.__olyBgTasks){
 const NWS=globalThis.WebSocket;
 const hook=ws=>{let buf='';ws.addEventListener('message',e=>{try{let d=e.data;if(typeof d!=='string')return;
  if(d.charCodeAt(0)===30){buf+=d.slice(1);if(buf.length>96e6)buf='';return}if(buf){d=buf+d;buf=''}
  if(!MARKERS.some(k=>d.indexOf(k)>=0))return;store.ingestIn(JSON.parse(d),{url:ws.url})}catch(_){}})};
 const W=function(...a){const ws=new NWS(...a);try{hook(ws)}catch(_){}return ws};
 W.prototype=NWS.prototype;for(const k of['CONNECTING','OPEN','CLOSING','CLOSED'])W[k]=NWS[k];
 for(const k of Object.keys(NWS))if(k.startsWith('__oly'))W[k]=NWS[k];W.__olyBgTasks=true;globalThis.WebSocket=W;
 const ps=NWS.prototype.send;NWS.prototype.send=function(d){try{if(typeof d==='string'&&d.indexOf('orchestration.subscribe')>=0)store.ingestOut(JSON.parse(d),{url:this.url})}catch(_){}return ps.call(this,d)};
}

const CARD='[data-thread-details-card]';
const BASE_CSS=`
.oly-bg{padding:6px 8px 8px;border-top:1px solid color-mix(in srgb,var(--border) 65%,transparent);font-size:12px;color:var(--foreground)}
section.oly-bg:first-child{border-top:0}
.oly-bg-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:24px;padding:0 6px}
.oly-bg-head h3{margin:0;font-size:11px;font-weight:500;color:var(--muted-foreground);white-space:nowrap}
.oly-bg-sum{font-size:11px;color:var(--muted-foreground);font-variant-numeric:tabular-nums;white-space:nowrap}
.oly-bg ul{list-style:none;margin:0;padding:0}
.oly-bg-row,.oly-bg-ghead{display:flex;align-items:center;gap:6px;min-height:28px;padding:0 6px;border-radius:4px}
.oly-bg-row:hover{background:color-mix(in srgb,var(--accent) 70%,transparent)}
.oly-bg-main{all:unset;box-sizing:border-box;display:flex;align-items:flex-start;gap:7px;flex:1 1 auto;min-width:0;min-height:28px;cursor:pointer}
.oly-bg-main>.oly-bg-ic{margin-top:3px}
.oly-bg-main>.oly-bg-dot{margin-top:10px}
.oly-bg-main:focus-visible{outline:2px solid var(--primary);outline-offset:1px;border-radius:2px}
.oly-bg-ic{display:inline-flex;flex:none;width:18px;height:18px;align-items:center;justify-content:center;color:var(--muted-foreground)}
.oly-bg-txt{display:flex;flex-direction:column;gap:2px;flex:1 1 auto;min-width:0;padding-block:5px}
.oly-bg-meta{display:flex;align-items:center;gap:6px;min-width:0}
.oly-bg-meta>.oly-bg-det{flex:1 1 auto;min-width:0}
.oly-bg-name,.oly-bg-det{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere}
.oly-bg-name{line-height:1.3;font-weight:500}
.oly-bg-det{line-height:1.35;color:var(--muted-foreground);font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;font-size:11px}
.oly-bg-row[data-type=agent] .oly-bg-det{font-family:inherit}
.oly-bg-link{flex:none;text-decoration:none;color:var(--primary);font-size:12px;padding:0 3px}
.oly-bg-st{flex:none;font-size:10.5px;line-height:16px;padding:0 6px;border-radius:2px;border:1px solid color-mix(in srgb,currentColor 35%,transparent);white-space:nowrap}
.oly-bg-st[data-state=run]{color:var(--primary)}
.oly-bg-st[data-state=wait]{color:#b7791f}
.oly-bg-st[data-state=ok]{color:#2f855a}
.oly-bg-st[data-state=err]{color:#c53030}
.oly-bg-t{flex:none;min-width:44px;text-align:right;font-size:11px;color:var(--muted-foreground);font-variant-numeric:tabular-nums;white-space:nowrap}
.oly-bg-row[data-state=ok] .oly-bg-name,.oly-bg-row[data-state=ok] .oly-bg-ic{opacity:.65}
.oly-bg-row[data-state=run] .oly-bg-ic svg{animation:oly-bg-pulse 1.6s ease-in-out infinite}
@keyframes oly-bg-pulse{50%{opacity:.45}}
@media (prefers-reduced-motion:reduce){.oly-bg-row[data-state=run] .oly-bg-ic svg{animation:none}}
.oly-bg-ghead .oly-bg-name{flex:1 1 auto;min-width:0}
.oly-bg-ghead b{font-weight:600;font-variant-numeric:tabular-nums}
.oly-bg-prog{flex:none;display:inline-flex;align-items:center;gap:6px;font-size:11px;font-variant-numeric:tabular-nums;color:var(--muted-foreground)}
.oly-bg-bar{display:inline-block;width:54px;height:4px;background:color-mix(in srgb,var(--foreground) 12%,transparent);overflow:hidden}
.oly-bg-bar>i{display:block;height:100%;background:var(--primary);transition:width .25s}
.oly-bg-bar>i[data-err]{background:#c53030}
.oly-bg-sub{margin-left:15px!important;border-left:1px solid color-mix(in srgb,var(--border) 80%,transparent)}
.oly-bg-sub .oly-bg-row{padding-left:10px}
.oly-bg-gbar{display:block!important;width:auto!important;height:3px;margin:-1px 8px 4px 34px}
.oly-bg-row[data-type=ci] .oly-bg-det{font-family:inherit}
.oly-bg-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--muted-foreground)}
.oly-bg-row[data-state=run] .oly-bg-dot{background:var(--primary)}
.oly-bg-row[data-state=wait] .oly-bg-dot{background:#b7791f}
.oly-bg-row[data-state=ok] .oly-bg-dot{background:#2f855a}
.oly-bg-row[data-state=err] .oly-bg-dot{background:#c53030}
[data-oly-bg-flash]{outline:2px solid var(--primary)!important;outline-offset:2px;transition:outline-color .6s}
`;
function ensureStyle(){if(document.getElementById('oly-bg-base'))return;const s=document.createElement('style');s.id='oly-bg-base';s.textContent=BASE_CSS;(document.head||document.documentElement).appendChild(s)}
function fiberRef(el){
 for(let e=el,d=0;e&&d<8;e=e.parentElement,d++){const k=Object.keys(e).find(k=>k.startsWith('__reactFiber$'));let f=k?e[k]:null;
  for(let i=0;f&&i<12;i++,f=f.return){const p=f.memoizedProps;if(p&&typeof p.threadId==='string'&&typeof p.environmentId==='string')return{env:p.environmentId,thread:p.threadId}
   const r=p&&p.threadRef;if(r&&typeof r.threadId==='string')return{env:str(r.environmentId),thread:r.threadId}}}
 return null;
}
function cardRef(card){
 const fk=card.closest('[data-workspace-focus-key^="details:"]');
 const m=fk&&/^details:([^:]+):(.+)$/.exec(fk.getAttribute('data-workspace-focus-key')||'');
 if(m)return{env:m[1],thread:m[2]};
 const f=fiberRef(card);if(f)return f;
 const r=core&&core.route?core.route():null;return r&&r.threadId?{env:'',thread:r.threadId}:null;
}
function sectionsParent(card){
 const s=card.querySelector('section:not(.oly-bg)');return s?s.parentElement:null;
}
function anchorIn(parent){
 for(const id of['thread-details-usage-heading','thread-details-context-heading']){
  const h=parent.querySelector(':scope>section>div>h3#'+id);if(h)return h.parentElement.parentElement}
 return null;
}
const W={passes:0,writes:0};
let raf=0;
function flush(){
 raf=0;W.passes++;const tm=Date.now();let any=false;
 for(const card of document.querySelectorAll(CARD)){
  const ref=cardRef(card),parent=sectionsParent(card);
  let sec=card.querySelector('section.oly-bg');
  const html=ref&&parent?renderHTML(store.view(ref.thread,tm),tm):'';
  if(!html){if(sec){sec.remove();W.writes++}continue}
  any=true;ensureStyle();
  if(!sec){sec=document.createElement('section');sec.className='oly-bg';sec.setAttribute('data-oly-bg','');sec.setAttribute('aria-label','Фоновые задачи');W.writes++}
  if(sec.__olyEnv!==ref.env)sec.__olyEnv=ref.env;
  const k=shape(html);if(sec.__olyShape!==k){sec.__olyShape=k;sec.innerHTML=html;W.writes++}
  const a=anchorIn(parent);
  if(sec.parentElement!==parent||(a?sec.nextElementSibling!==a:parent.lastElementChild!==sec)){parent.insertBefore(sec,a);W.writes++}
 }
 tickOn(any);
}
const schedule=()=>{if(!raf)raf=requestAnimationFrame(flush)};
// Elapsed time: text of <time> only, once a second while a section is on screen.
let tick=0;
function tickOn(on){if(on&&!tick)tick=setInterval(()=>{if(document.hidden)return;const tm=Date.now();let n=0;
  for(const t of document.querySelectorAll('section.oly-bg time[data-since]')){n++;const u=+t.getAttribute('data-until')||tm;const v=elapsed(u-+t.getAttribute('data-since'));if(t.textContent!==v)t.textContent=v}
  if(!n){clearInterval(tick);tick=0}},1000);
 else if(!on&&tick){clearInterval(tick);tick=0}}
store.subscribe(schedule);
const ours=n=>{const e=n&&(n.nodeType===1?n:n.parentElement);return !!(e&&e.closest('section.oly-bg'))};
const mo=new MutationObserver(ms=>{
 if(raf)return;
 for(const m of ms){
  if(ours(m.target))continue;
  const e=m.target.nodeType===1?m.target:m.target.parentElement;
  if(e&&e.closest(CARD)){schedule();return}
  for(const a of m.addedNodes)if(a.nodeType===1&&!ours(a)&&(a.matches(CARD)||a.querySelector(CARD))){schedule();return}
 }
});
// Clicks: subagent → its thread; command → its row in the timeline; ↗ links open by themselves.
function openThread(env,id){
 const tail='/'+encodeURIComponent(id);
 for(const a of document.querySelectorAll('a[href]')){if(ours(a))continue;const h=a.getAttribute('href')||'';if(h.endsWith(tail)||h.endsWith('/'+id)){a.click();return true}}
 if(!env){const r=core&&core.route?core.route():null;const p=(r&&(r.hash.startsWith('#/')?r.hash.slice(1):r.path)||'').split('/').filter(Boolean);if(p.length>=2)env=decodeURIComponent(p[0])}
 if(!env)return false;
 const path='/'+encodeURIComponent(env)+tail;
 if((location.hash||'').startsWith('#/'))location.hash='#'+path;
 else{history.pushState(history.state,'',path);dispatchEvent(new PopStateEvent('popstate',{state:history.state}))}
 return true;
}
function reveal(ids){
 for(const id of ids){if(!id)continue;let el=null;
  try{el=document.querySelector('[data-work-entry-id="'+CSS.escape(id)+'"]')}catch(_){}
  if(el){el.scrollIntoView({block:'center',behavior:'smooth'});el.setAttribute('data-oly-bg-flash','');setTimeout(()=>el.removeAttribute('data-oly-bg-flash'),1400);return true}}
 return false;
}
document.addEventListener('click',e=>{
 const b=e.target&&e.target.closest&&e.target.closest('section.oly-bg [data-oly-bg-act]');if(!b)return;
 const sec=b.closest('section.oly-bg');
 if(b.getAttribute('data-oly-bg-act')==='thread'){e.preventDefault();openThread(sec&&sec.__olyEnv||'',b.getAttribute('data-oly-bg-thread')||'')}
 else if(!reveal((b.getAttribute('data-oly-bg-ids')||'').split('\n'))){const t=b.getAttribute('title')||'';
  if(!t.endsWith('(нет в ленте)')){b.setAttribute('title',t+'\n(нет в ленте)')}}
});
const start=()=>{mo.observe(document.body,{subtree:true,childList:true});schedule()};
document.body?start():addEventListener('DOMContentLoaded',start,{once:true});
api.flush=flush;api.stats=W;
}catch(e){console.warn('oly bg-tasks',e)}})();

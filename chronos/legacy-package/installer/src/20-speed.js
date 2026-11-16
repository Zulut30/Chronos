;(()=>{try{
/* oly speed: real model speed (tokens/s).
   Source = the app's own WebSocket frames (read-only sniffing).
   1) Precise: while a thread is open, provider-turn updates carry per-request token usage. Claude sends it twice per
      request (message_start ≈ 5 tokens, then the final count) with server timestamps → decode speed without
      time-to-first-token (TTFT) and without tools. TTFT = request start − (previous request end | last tool end).
   2) Estimate: completed turns from history: output tokens / (turn time − tool/approval time − requests × TTFT).
   3) Live chip: streamed text growth → token estimate (o200k-style pre-tokenizer + per-model calibration). */
if(globalThis.__olySpeed)return;
const LS=(k,v)=>{try{if(v===undefined)return localStorage.getItem(k);if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v)}catch(e){return null}};
const KEY='oly-speed-v2',NMAX=60;
const fresh=()=>({v:2,m:{},seen:{}});
let S=(()=>{try{const x=JSON.parse(LS(KEY));if(x&&x.v===2&&x.m)return x}catch(e){}return fresh()})();
let dirty=false,ver=1;
const M=id=>S.m[id]||(S.m[id]={d:'',r:[],g:[],t:[],f:[],c:1});
const push=(a,x)=>{a.push(x);if(a.length>NMAX)a.splice(0,a.length-NMAX)};
const touch=()=>{dirty=true;ver++};
function save(){if(!dirty)return;dirty=false;const ks=Object.keys(S.seen);if(ks.length>3000)for(const k of ks.slice(0,ks.length-2000))delete S.seen[k];LS(KEY,JSON.stringify(S))}
setInterval(save,3000);addEventListener('pagehide',save);

/* ---- token estimate: o200k-like pre-tokenization, per-piece cost ---- */
const RE=/\p{L}[\p{L}\p{M}']*|\p{N}{1,3}|[^\s\p{L}\p{N}]+|\s+/gu;
function estTok(s){let n=0;RE.lastIndex=0;let m;while((m=RE.exec(s))){const w=m[0],l=w.length,c=w.charCodeAt(0);
 if(c<=32||c===160){if(l>1||w==='\n')n+=1;continue}
 if(c>=48&&c<=57){n+=1;continue}
 if(/\p{L}/u.test(w[0])){
  if(c<0x250)n+=l<=8?1:1+Math.ceil((l-8)/5);            /* latin */
  else if(c>=0x400&&c<0x530)n+=Math.max(1,Math.ceil(l/3.6)); /* cyrillic */
  else if(c>=0x2E80)n+=Math.ceil(l*.85);                  /* CJK/kana */
  else n+=Math.max(1,Math.ceil(l/2.5));
  continue}
 n+=Math.max(1,Math.ceil(l/2.2))}
 return n}

/* ---- state ---- */
const items=new Map();      // itemId → {type,turn,thread,a,b,len}
const turnItems=new Map();  // turnId → Set(itemRec)
const turns=new Map();      // turnId → {status,t0,t1,model,driver,thread,usage,ws,reqs[],live}
const textPts=new Map();    // threadId → [[serverMs,localMs,cumEstTokens]]
const lastReq=new Map();    // threadId → {model,v,at}
const threadModel=new Map();// threadId → model id (latest turn)
const NONTOOL={assistant_message:1,reasoning:1,subagent:1,system_notice:1,user_message:1,plan:1,error:1,context_compaction:1};
const TEXTY={assistant_message:1,reasoning:1};
const D=s=>{const t=s?Date.parse(s):NaN;return t>0?t:NaN};
const R=(x,c)=>typeof x==='number'?(c.ids&&c.ids[x]!=null?String(c.ids[x]):'#'+x):x==null?null:String(x);

function addPt(th,st,e){if(!th)return;let p=textPts.get(th);if(!p){p=[];textPts.set(th,p)}
 const cum=(p.length?p[p.length-1][2]:0)+e;p.push([st,performance.now(),cum]);while(p.length>2&&p[p.length-1][0]-p[0][0]>30000)p.shift()}
function onItem(it,c){const id=R(it.id,c);if(!id)return;const turn=R(it.providerTurnId,c);
 let r=items.get(id),isNew=false;if(!r){r={len:0};items.set(id,r);isNew=true}
 r.type=it.type;r.thread=R(it.threadId,c)||c.thread||r.thread;r.a=D(it.startedAt);r.b=D(it.completedAt);
 if(turn&&turn!==r.turn){r.turn=turn;let s=turnItems.get(turn);if(!s){s=new Set();turnItems.set(turn,s)}s.add(r)}
 if(TEXTY[it.type]&&typeof it.text==='string'){const L=it.text.length;
  if(it.streaming===true){const st=D(it.updatedAt)||Date.now();
   if(isNew||L<r.len)addPt(r.thread,st,0);else if(L>r.len)addPt(r.thread,st,estTok(it.text.slice(r.len)))}
  if(L>=r.len||it.streaming!==true)r.len=L}}
function lastToolEnd(turn,before){let x=0;const s=turnItems.get(turn);if(s)for(const r of s){if(NONTOOL[r.type])continue;if(r.b>x&&r.b<=before+500)x=r.b}return x}
function onTurn(t,c){const id=R(t.id,c);if(!id)return;let T=turns.get(id);if(!T){T={reqs:[],live:false};turns.set(id,T)}
 T.status=t.status||T.status;T.t0=D(t.startedAt);T.t1=D(t.completedAt);
 const tu=t.turnTokenUsage;if(tu)T.usage=tu;
 T.model=t.model||(tu&&tu.models&&tu.models[0])||T.model;T.driver=(t.nativeTurnRef&&t.nativeTurnRef.driver)||T.driver;
 if(c.ws!==undefined)T.ws=c.ws;if(c.thread&&!T.thread)T.thread=c.thread;
 if(!T.thread){const s=turnItems.get(id);if(s)for(const r of s)if(r.thread){T.thread=r.thread;break}}
 if(T.thread&&T.model)threadModel.set(T.thread,T.model);
 if(t.status==='running')T.live=true;
 const u=t.tokenUsage;if(u&&typeof u.outputTokens==='number'){const ut=D(u.updatedAt);if(ut>0){
  const rk=(u.inputTokens|0)+'|'+(u.cachedInputTokens|0);let q=T.reqs[T.reqs.length-1];
  if(!q||q.k!==rk){const prev=q;if(prev&&!prev.done)fin(id,T,prev);
   q={k:rk,o0:u.outputTokens,t0:ut,o1:u.outputTokens,t1:ut,live:t.status==='running',prevEnd:prev?prev.t1:0,prevKnown:!!(prev&&prev.live),done:false};
   T.reqs.push(q);if(T.reqs.length>300)T.reqs.shift()}
  else if(ut>=q.t1&&u.outputTokens>=q.o1){q.o1=u.outputTokens;q.t1=ut}}}
 if(t.status&&t.status!=='running'){const q=T.reqs[T.reqs.length-1];if(q&&!q.done)fin(id,T,q)}
 pendingTurns.add(id)}
function fin(id,T,q){q.done=true;if(!q.live||!T.model)return;const B=M(T.model);if(T.driver)B.d=T.driver;
 const dTok=q.o1-q.o0,dt=q.t1-q.t0,issue=Math.max(q.prevEnd||0,lastToolEnd(id,q.t0));let v=null;
 if(dTok>=30&&dt>=300){v=dTok/dt*1000;if(!(v>1&&v<5000))return;push(B.r,[dTok,Math.round(dt),Date.now()]);
  if(q.o0<=40&&q.prevKnown&&issue>0){const f=q.t0-issue;if(f>=0&&f<120000)push(B.f,Math.round(f))}
  const p=textPts.get(T.thread);if(p&&p.length>1){let a=null,b=null;for(const x of p){if(x[0]<=q.t0+200)a=x;if(x[0]<=q.t1+400)b=x}
   if(a&&b&&b[2]>a[2]){const k=dTok/(b[2]-a[2]);if(k>.4&&k<2.5)B.c=Math.min(1.8,Math.max(.6,(B.c||1)*.85+k*.15))}}}
 else if(q.o0===q.o1&&q.prevKnown&&issue>0&&q.o1>=30){const ms=q.t1-issue;if(ms>300&&ms<600000){push(B.g,[q.o1,Math.round(ms),Date.now()]);const L=ttft(T.model);v=q.o1/Math.max(ms-L,ms*.35)*1000}}
 if(v!=null){touch();if(T.thread)lastReq.set(T.thread,{model:T.model,v,at:Date.now()})}}
const pendingTurns=new Set();
function evalTurn(id){const T=turns.get(id);if(!T||T.status!=='completed')return;const u=T.usage;
 if(!u||u.usageStatus!=='complete'||!(u.outputTokens>0)||!(T.t1>T.t0)||!T.model)return;
 const key=T.model+'|'+T.t0+'|'+u.outputTokens;if(S.seen[key])return;
 if(T.ws===Infinity||(T.ws>0&&T.t0<T.ws))return;               /* items window does not cover this turn */
 const s=turnItems.get(id);if(!s||!s.size)return;let nText=0,first=Infinity;const iv=[];
 for(const r of s){if(r.a<first)first=r.a;if(TEXTY[r.type]){nText++;continue}if(NONTOOL[r.type]||!(r.a>0))continue;
  const a=Math.max(T.t0,r.a),b=Math.min(T.t1,r.b>0?r.b:T.t1);if(b>a)iv.push([a,b])}
 if(!nText||first-T.t0>120000)return;
 iv.sort((x,y)=>x[0]-y[0]);let busy=0,blocks=0,ca=-1,cb=-1;for(const[a,b]of iv){if(a>cb){if(cb>ca){busy+=cb-ca;blocks++}ca=a;cb=b}else if(b>cb)cb=b}if(cb>ca){busy+=cb-ca;blocks++}
 const gen=(T.t1-T.t0)-busy;if(gen<1500)return;
 S.seen[key]=1;const B=M(T.model);if(T.driver)B.d=T.driver;push(B.t,[u.outputTokens,Math.round(gen),blocks+1,Date.now()]);touch()}

/* ---- frame parsing ---- */
function walk(o,c,d){if(!o||typeof o!=='object'||d>14)return;
 if(Array.isArray(o)){for(const x of o)walk(x,c,d+1);return}
 if(Array.isArray(o.ids)&&o.ids.length&&typeof o.ids[0]==='string'){c={ids:o.ids,thread:c.thread};const p=o.projection;
  if(p&&p.thread&&p.thread.id!=null)c.thread=R(p.thread.id,c);
  if(o.hasMoreHistory===true){let ws=Infinity;for(const v of (p&&p.visibleTurnItems)||[]){const t=D(v&&v.item&&v.item.startedAt);if(t<ws)ws=t}c.ws=ws}else if(o.hasMoreHistory===false)c.ws=0}
 if(o.event&&typeof o.event==='object'&&typeof o.event.threadId==='string')c={ids:null,thread:o.event.threadId};
 if(o.item&&typeof o.item==='object'&&typeof o.item.type==='string'&&'providerTurnId' in o.item)onItem(o.item,c);
 else if(typeof o.type==='string'&&'providerTurnId' in o&&'ordinal' in o)onItem(o,c);
 if(o.nativeTurnRef&&('tokenUsage' in o||'turnTokenUsage' in o)&&'startedAt' in o)onTurn(o,c);
 for(const k in o){if(k==='item'||k==='ids')continue;const v=o[k];if(v&&typeof v==='object')walk(v,c,d+1)}}
const dbg=globalThis.__olySpeed={frames:0,parsed:0,items,turns,textPts,lastReq,est:estTok,get S(){return S}};
function feed(data){dbg.frames++;if(typeof data!=='string'||data.length<60)return;
 if(data.indexOf('providerTurnId')<0&&data.indexOf('okenUsage')<0)return;
 try{dbg.parsed++;walk(JSON.parse(data),{ids:null,thread:null},0);for(const id of pendingTurns)evalTurn(id);pendingTurns.clear()}catch(e){dbg.err=String(e)}}
const NativeWS=window.WebSocket;
if(NativeWS&&!NativeWS.__olySpeed){const W=function(...a){const ws=new NativeWS(...a);try{let buf='';ws.addEventListener('message',e=>{try{let d=e.data;if(typeof d!=='string')return;
  if(d.charCodeAt(0)===30){buf+=d.slice(1);if(buf.length>64e6)buf='';return}if(buf){d=buf+d;buf=''}feed(d)}catch(_){}})}catch(_){}return ws};
 W.prototype=NativeWS.prototype;for(const k of['CONNECTING','OPEN','CLOSING','CLOSED'])W[k]=NativeWS[k];W.__olySpeed=true;W.__oly=NativeWS.__oly;window.WebSocket=W}
dbg.feed=feed;

/* ---- statistics ---- */
const qtl=(a,p)=>{if(!a.length)return NaN;const i=(a.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);return a[lo]+(a[hi]-a[lo])*(i-lo)};
function robust(list){const s=list.filter(x=>x.ms>0&&x.tok>0).map(x=>({tok:x.tok,ms:x.ms,sp:x.tok/x.ms*1000})).filter(x=>x.sp>.5&&x.sp<5000);if(!s.length)return null;
 const sorted=s.map(x=>x.sp).sort((a,b)=>a-b),med=qtl(sorted,.5),mad=qtl(sorted.map(v=>Math.abs(v-med)).sort((a,b)=>a-b),.5)*1.4826;
 const k=s.length>=4&&mad>0?s.filter(x=>Math.abs(x.sp-med)<=3*mad):s;const tok=k.reduce((a,x)=>a+x.tok,0),ms=k.reduce((a,x)=>a+x.ms,0);
 const ks=k.map(x=>x.sp).sort((a,b)=>a-b);return{v:tok/ms*1000,lo:qtl(ks,.25),hi:qtl(ks,.75),n:k.length,drop:s.length-k.length,series:s.map(x=>x.sp)}}
function ttftOf(B){if(!B||!B.f||!B.f.length)return NaN;return qtl(B.f.slice().sort((a,b)=>a-b),.5)}
function ttft(id){let v=ttftOf(S.m[id]);if(v>=0)return v;const d=S.m[id]&&S.m[id].d;const all=[];for(const k in S.m)if(S.m[k].d===d)all.push(...(S.m[k].f||[]));
 if(all.length)return qtl(all.sort((a,b)=>a-b),.5);return 1200}
function modelSpeed(id){const B=S.m[id];if(!B)return null;const L=ttft(id),f=ttftOf(B);
 if(B.r.length>=3){const r=robust(B.r.map(x=>({tok:x[0],ms:x[1]})));if(r)return Object.assign(r,{method:'exact',ttft:f,d:B.d,c:B.c})}
 const list=B.r.map(x=>({tok:x[0],ms:x[1]}))
  .concat(B.g.map(x=>({tok:x[0],ms:Math.max(x[1]-L,x[1]*.35)})))
  .concat(B.t.map(x=>({tok:x[0],ms:Math.max(x[1]-x[2]*L,x[1]*.35)})));
 const r=robust(list);return r?Object.assign(r,{method:'est',ttft:f,d:B.d,c:B.c}):null}
const norm=s=>String(s||'').toLowerCase().replace(/<[^>]*>/g,'').replace(/[^a-z0-9а-яё]+/g,'-').replace(/^-+|-+$/g,'');
function findModel(name){const n=norm(name);if(!n)return null;if(S.m[name])return name;let best=null,bn=-1;
 for(const k in S.m){const kn=norm(k);if(kn===n||kn.endsWith('-'+n)||n.endsWith('-'+kn)||kn.replace(/^(claude|gpt|openai|anthropic)-/,'')===n.replace(/^(claude|gpt|openai|anthropic)-/,'')){const B=S.m[k],cnt=B.r.length+B.g.length+B.t.length;if(cnt>bn){bn=cnt;best=k}}}
 return best}
const fmt=v=>v==null||!isFinite(v)?'—':v>=100?Math.round(v).toString():v.toFixed(1).replace('.',',');
const fmtS=ms=>!(ms>=0)?'—':(ms/1000).toFixed(ms<10000?1:0).replace('.',',')+' с';
const PROV={claudeAgent:'Claude',claude:'Claude',codex:'Codex',openrouter:'OpenRouter',opencode:'OpenCode',gemini:'Gemini',cursor:'Cursor'};
const prov=d=>PROV[d]||(d?d[0].toUpperCase()+d.slice(1):'Другие');
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const plural=(n,a,b,c)=>{const m10=n%10,m100=n%100;return n+' '+(m10===1&&m100!==11?a:m10>=2&&m10<=4&&(m100<10||m100>=20)?b:c)};

/* ---- live (text-based) ---- */
function liveRate(th){const p=th&&textPts.get(th);if(!p||p.length<2)return null;const now=performance.now(),last=p[p.length-1];if(now-last[1]>4500)return null;
 let a=null;for(const x of p){if(last[0]-x[0]<=9000){a=x;break}}if(!a||a===last)return null;const span=last[0]-a[0];if(span<1200||last[2]<=a[2])return null;
 const m=threadModel.get(th),c=(m&&S.m[m]&&S.m[m].c)||1;return (last[2]-a[2])/(span/1000)*c}
function curThread(){const seg=location.pathname.split('/').filter(Boolean);if(seg.length<2)return null;try{return decodeURIComponent(seg[seg.length-1])}catch(e){return seg[seg.length-1]}}
function composerModel(host){const b=host&&host.querySelector('button[data-composer-shortcut~="composer.effort"]');const l=b&&(b.getAttribute('aria-label')||b.textContent)||'';return l.split(',')[0].trim()}

/* ---- styles (base: T3 variables; Olympus look in olympus-v2/feature-css/speed.*.css) ---- */
const css=document.createElement('style');css.id='oly-speed-css';
css.textContent=`
.oly-speed{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 8px;border-radius:var(--control-radius,6px);color:var(--muted-foreground);font-size:13px;line-height:1;white-space:nowrap;flex-shrink:0;cursor:default;font-variant-numeric:tabular-nums}
.oly-speed svg{width:14px;height:14px;flex-shrink:0;opacity:.85}
.oly-speed[data-live=true]{color:var(--foreground)}
.oly-speed[data-live=true] svg{animation:oly-speed-pulse 1.2s ease-in-out infinite}
@keyframes oly-speed-pulse{50%{opacity:.3}}
.oly-stats{padding:16px 18px;border:1px solid var(--border);border-radius:var(--radius,8px);background:var(--card,transparent);color:var(--foreground)}
.oly-stats-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:12px}
.oly-stats-head>div{flex:1;min-width:0}
.oly-stats h3{margin:0 0 4px;font-size:14px;font-weight:500}
.oly-stats p{margin:0;font-size:12px;line-height:1.45;color:var(--muted-foreground)}
.oly-stats-reset{height:28px;padding:0 10px;border:1px solid var(--border);border-radius:var(--control-radius,6px);background:transparent;color:var(--muted-foreground);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.oly-stats-reset:hover{background:var(--accent);color:var(--foreground)}
.oly-stats-reset[data-armed=true]{color:var(--destructive,#d33);border-color:currentColor}
.oly-stats-sum{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.oly-stats .big{font-size:28px;font-weight:500;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
.oly-stats .sub{color:var(--muted-foreground);font-size:13px}
.oly-stats table{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}
.oly-stats th{text-align:left;font-weight:400;color:var(--muted-foreground);padding:4px 10px 6px 0;font-size:12px;white-space:nowrap}
.oly-stats td{padding:7px 10px 7px 0;border-top:1px solid var(--border);vertical-align:middle}
.oly-stats td.num,.oly-stats th.num{text-align:right}
.oly-stats tr.grp td{padding-top:12px;border-top:0;font-size:12px;color:var(--muted-foreground);font-weight:500}
.oly-stats tr.grp td b{color:var(--foreground);font-weight:500}
.oly-stats .rng{color:var(--muted-foreground);font-size:12px}
.oly-stats .tag{display:inline-block;padding:1px 6px;border-radius:999px;font-size:11px;line-height:16px;border:1px solid var(--border);color:var(--muted-foreground)}
.oly-stats .tag[data-m=exact]{color:var(--foreground)}
.oly-stats .mdl{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12.5px}
.oly-spark{display:block;width:120px;height:22px;color:var(--primary,currentColor)}
.oly-spark path{fill:none;stroke:currentColor;stroke-width:1.5;stroke-linejoin:round;stroke-linecap:round}
.oly-spark circle{fill:currentColor}
.oly-stats .empty{font-size:13px;color:var(--muted-foreground);padding:6px 0 2px}
.oly-stats .foot{margin-top:10px}
@media (min-width:640px){dl.oly-dl5{grid-template-columns:repeat(5,minmax(0,1fr))!important}}
.oly-dd-unit{font-size:13px;font-weight:400;color:var(--muted-foreground);margin-left:3px}
.oly-pick-speed{flex-shrink:0;margin-left:auto;padding-left:8px;font-size:11.5px;color:var(--muted-foreground);font-variant-numeric:tabular-nums;white-space:nowrap}`;
(document.head||document.documentElement).appendChild(css);

/* ---- composer chip ---- */
const ICON_BOLT='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>';
function chip(){const host=document.querySelector('[data-slot=composer-host]');if(!host)return;
 let sp=host.querySelector('.oly-speed');
 if(!sp){const plan=host.querySelector('.oly-plan'),anchor=plan||host.querySelector('button[data-composer-shortcut~="composer.effort"]');if(!anchor||!anchor.parentElement)return;
  sp=document.createElement('span');sp.className='oly-chip oly-speed';sp.innerHTML=ICON_BOLT+'<span></span>';anchor.parentElement.insertBefore(sp,anchor)}
 const th=curThread(),live=liveRate(th),lr=th&&lastReq.get(th),cm=findModel(composerModel(host)),ms=cm&&modelSpeed(cm);
 let txt,title,isLive=false;
 if(live!=null){isLive=true;txt=fmt(live)+' ток/с';title='Скорость генерации сейчас — оценка по потоку текста, откалибрована по реальным счётчикам токенов.'}
 else if(lr&&Date.now()-lr.at<15*60e3){txt='≈ '+fmt(lr.v)+' ток/с';title='Последний запрос в этом треде ('+lr.model+'): '+fmt(lr.v)+' ток/с.'}
 else if(ms){txt='≈ '+fmt(ms.v)+' ток/с';title='Средняя скорость '+cm+'.'}
 if(ms)title+='\n'+cm+': '+fmt(ms.v)+' ток/с ('+(ms.method==='exact'?'точно':'оценка')+', '+plural(ms.n,'замер','замера','замеров')+')'+(ms.ttft>=0?'\nПервый токен ≈ '+fmtS(ms.ttft):'');
 sp.style.display=txt?'':'none';if(!txt)return;sp.dataset.live=String(isLive);
 if(sp.lastChild.textContent!==txt)sp.lastChild.textContent=txt;if(sp.title!==title)sp.title=title}

/* ---- usage page card ---- */
function spark(series){const s=series.slice(-30);if(s.length<2)return'';const w=120,h=22,mx=Math.max(...s),mn=Math.min(...s),rg=mx-mn||1;
 const pts=s.map((v,i)=>[(i/(s.length-1))*(w-4)+2,h-3-((v-mn)/rg)*(h-6)]);const d='M'+pts.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join('L');const l=pts[pts.length-1];
 return '<svg class="oly-spark" viewBox="0 0 '+w+' '+h+'" aria-hidden="true"><path d="'+d+'"/><circle cx="'+l[0].toFixed(1)+'" cy="'+l[1].toFixed(1)+'" r="2"/></svg>'}
let cardVer=0,armT=0;
function ensureStats(){if(!/^\/usage/.test(location.pathname))return;let card=document.querySelector('.oly-stats');
 if(!card){const dlg=document.querySelector('[role=dialog][data-slot=dialog-popup]');const vp=dlg&&dlg.querySelector('[data-slot=scroll-area-viewport]');const target=vp&&vp.firstElementChild;if(!target)return;
  card=document.createElement('section');card.className='oly-stats';card.style.cssText='max-width:976px;margin:24px auto 4px;width:calc(100% - 48px);box-sizing:border-box';target.insertBefore(card,target.firstChild);cardVer=0;
  card.addEventListener('click',e=>{const b=e.target.closest('.oly-stats-reset');if(!b)return;
   if(b.dataset.armed==='true'){S=fresh();lastReq.clear();touch();save();b.dataset.armed='false';updateStats(true)}
   else{b.dataset.armed='true';b.textContent='Точно сбросить?';clearTimeout(armT);armT=setTimeout(()=>{b.dataset.armed='false';b.textContent='Сбросить'},3500)}})}
 updateStats()}
function updateStats(force){const card=document.querySelector('.oly-stats');if(!card||(!force&&cardVer===ver))return;
 if(card.querySelector('.oly-stats-reset[data-armed=true]')&&!force)return;cardVer=ver;
 const groups={};let allTok=0,allMs=0,allN=0;
 for(const id in S.m){const s=modelSpeed(id);if(!s)continue;const g=prov(S.m[id].d);(groups[g]=groups[g]||[]).push([id,s]);allN+=s.n;const w=s.n;allTok+=s.v*w;allMs+=w}
 const head='<div class="oly-stats-head"><div><h3>Скорость моделей</h3><p>Токены в секунду при генерации ответа. «Точно» — по счётчикам токенов провайдера во время потока: без ожидания первого токена, инструментов и подтверждений. «Оценка» — по завершённым ходам из истории: из времени хода вычтены инструменты и задержка до первого токена. Выбросы отброшены, учитываются последние '+NMAX+' замеров каждой модели.</p></div><button type="button" class="oly-stats-reset" data-armed="false">Сбросить</button></div>';
 const names=Object.keys(groups).sort((a,b)=>groups[b].reduce((s,x)=>s+x[1].n,0)-groups[a].reduce((s,x)=>s+x[1].n,0));
 if(!names.length){card.innerHTML=head+'<div class="empty">Пока нет замеров. Откройте тред, где модель отвечает, — скорость появится после первого запроса.</div>';return}
 let rows='';for(const g of names){const list=groups[g].sort((a,b)=>b[1].n-a[1].n);const gw=list.reduce((s,x)=>s+x[1].n,0),gv=list.reduce((s,x)=>s+x[1].v*x[1].n,0)/gw;
  rows+='<tr class="grp"><td colspan="6"><b>'+esc(g)+'</b> · '+fmt(gv)+' ток/с</td></tr>';
  for(const[id,s]of list){rows+='<tr><td class="mdl">'+esc(id)+'</td><td class="num"><b>'+fmt(s.v)+'</b> ток/с<div class="rng">'+(s.n>2?fmt(s.lo)+'–'+fmt(s.hi):'&nbsp;')+'</div></td><td class="num">'+fmtS(s.ttft)+'</td><td class="num">'+s.n+(s.drop?'<div class="rng">−'+s.drop+' выбр.</div>':'')+'</td><td><span class="tag" data-m="'+s.method+'">'+(s.method==='exact'?'точно':'оценка')+'</span></td><td>'+spark(s.series)+'</td></tr>'}}
 card.innerHTML=head+'<div class="oly-stats-sum"><span class="big">'+fmt(allTok/allMs)+'</span><span class="sub">ток/с в среднем · '+plural(allN,'замер','замера','замеров')+' · '+plural(Object.keys(S.m).length,'модель','модели','моделей')+'</span></div>'+
  '<table><thead><tr><th>Модель</th><th class="num">Скорость</th><th class="num">Первый токен</th><th class="num">Замеров</th><th>Метод</th><th>Последние замеры</th></tr></thead><tbody>'+rows+'</tbody></table>'}

/* ---- usage model dialog: «Скорость» stat ---- */
function ensureDialogStat(){for(const dlg of document.querySelectorAll('[role=dialog][data-slot=dialog-popup]')){
 const h=dlg.querySelector('h2[data-slot=dialog-title]'),dl=dlg.querySelector('dl');if(!h||!dl)continue;
 const dts=[...dl.querySelectorAll(':scope>div>dt')].map(x=>x.textContent.trim());if(!dts.some(x=>/^(Стоимость|Cost)$/.test(x))||!dts.some(x=>/кэш|cache/i.test(x)))continue;
 const id=findModel(h.textContent.trim()),s=id&&modelSpeed(id);let cell=dl.querySelector('.oly-dl-speed');
 if(!cell){const proto=dl.querySelector(':scope>div');cell=document.createElement('div');cell.className=(proto&&proto.className||'flex min-w-0 flex-col gap-0.5')+' oly-dl-speed';
  const pdt=proto&&proto.querySelector('dt'),pdd=proto&&proto.querySelector('dd');
  cell.innerHTML='<dt class="'+esc(pdt?pdt.className:'text-xs text-muted-foreground')+'">Скорость</dt><dd class="'+esc(pdd?pdd.className:'text-2xl font-semibold text-foreground')+'"></dd>';dl.appendChild(cell);dl.classList.add('oly-dl5')}
 const dd=cell.querySelector('dd'),html=s?'≈ '+fmt(s.v)+'<span class="oly-dd-unit">ток/с</span>':'—';if(dd.innerHTML!==html)dd.innerHTML=html;
 cell.title=s?(s.method==='exact'?'Точно: по счётчикам токенов провайдера':'Оценка по завершённым ходам')+' · '+plural(s.n,'замер','замера','замеров')+(s.n>2?'\nДиапазон '+fmt(s.lo)+'–'+fmt(s.hi)+' ток/с':'')+(s.ttft>=0?'\nПервый токен ≈ '+fmtS(s.ttft):''):'Нет замеров скорости для этой модели'}}

/* ---- model picker: speed next to each model ---- */
function ensurePicker(){const opts=document.querySelectorAll('[data-slot=combobox-item]');if(!opts.length)return;
 for(const o of opts){const nameEl=o.querySelector('[data-slot=combobox-item-content] .truncate');if(!nameEl)continue;
  const sr=nameEl.querySelector('.sr-only');const name=(nameEl.textContent||'').replace(sr?sr.textContent:'','').trim();
  const id=findModel(name),s=id&&modelSpeed(id);let tag=o.querySelector('.oly-pick-speed');
  if(!s){if(tag)tag.remove();continue}
  if(!tag){tag=document.createElement('span');tag.className='oly-pick-speed';nameEl.parentElement.appendChild(tag)}
  const t=fmt(s.v)+' ток/с';if(tag.textContent!==t)tag.textContent=t;tag.title='Средняя скорость '+id+(s.method==='exact'?' (точно)':' (оценка)')}}

/* ---- loop ---- */
let pending=false;const tick=()=>{pending=false;try{chip();ensureStats();ensureDialogStat();ensurePicker()}catch(e){console.warn('oly speed',e)}};
const start=()=>{new MutationObserver(()=>{if(!pending){pending=true;requestAnimationFrame(tick)}}).observe(document.body,{childList:true,subtree:true});setInterval(()=>{try{chip();updateStats();ensureDialogStat()}catch(e){}},800);tick()};
document.body?start():addEventListener('DOMContentLoaded',start);
}catch(e){console.warn('oly speed',e)}})();

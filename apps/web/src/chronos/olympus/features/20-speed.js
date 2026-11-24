;(()=>{try{
/* oly speed: real model speed (tokens/s) for every T3 provider.
   Source = the app's own WebSocket frames (read-only sniffing): provider turns (token usage with server timestamps),
   turn items (start/end of text, reasoning, tools, subagents), runs (model of a turn) and runtime requests (approvals,
   questions). All times are server timestamps.
   Exact («точно») = provider token counts over a measured generation window; time-to-first-token (TTFT), tools,
   subagents and approvals are never inside the window:
    s  stream: several usage points inside one request (Claude: message_start → message_delta; Pi: live usage)
       → Δtokens / Δtime.
    a  anchored: one usage point at the end of a request (Codex per response, OpenCode/OpenRouter last step, Muse,
       any provider from history) → tokens / (usage time − start of the request's first streamed item). Tokens made
       before that item (hidden reasoning: Codex without a reasoning item, OpenRouter models that hide it) are left
       out of the numerator; Claude (thinking inside outputTokens, split unknown) anchors only on a thinking item.
       The request start = latest of: previous request end, end of a tool / subagent / approval,
       turn start.
   Token meaning per driver: Claude and Codex outputTokens include reasoning, OpenCode reports reasoning separately,
   unknown drivers: reasoning > output ⇒ separate. Pi single points are session totals → ignored.
   Estimate («≈»): whole turns (turnTokenUsage): tokens / (turn time − tools/subagents/approvals − requests × TTFT);
   single request points without a streamed item: tokens / (end − request start − TTFT); live chip: streamed text
   growth → tokens (o200k-like pre-tokenizer, per-model calibration from exact samples), pauses skipped.
   Every sample is kept per «model + reasoning level + speed mode» (combo). Level and mode come from the run's own
   modelSelection (the selection the turn was sent with; Codex subagents: the provider-reported subagent selection),
   never from the current composer switch. Level ids: reasoningEffort / effort / variant / thinking_level / … (same set
   as T3), mode: serviceTier (default→std, priority|fast→fast, ultrafast, flex) or fastMode (true→fast); selection
   without a mode option → std; no selection at all → level and mode «не указан». Combo key = level+'|'+mode.
   Storage oly-speed-v4 = {v:4,m:{model:{d,i,c,x:{combo:{r,g,t,f}}}},seen}. Migrated from v3 / v2 into combo '|'
   (level and mode not recorded then); old keys are left untouched as a backup.
   Default level / mode: a selection without the option is sent with the model's default (the server does the same), so
   the default is learned from provider snapshots (models[].capabilities.optionDescriptors[].options[].isDefault) per
   «instance|model» and kept in S.def. Samples recorded as '|<mode>' (selection known, level missing, default unknown
   at the time) are moved once to '<default>|<mode>' when the default becomes known; combo '|' (no selection at all,
   or v2/v3 data) stays «не указан»: the level could have been any explicit choice. */
if(globalThis.__olySpeed)return;
const LS=(k,v)=>{try{if(v===undefined)return localStorage.getItem(k);if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v)}catch(e){return null}};
const KEY='oly-speed-v4',OLD3='oly-speed-v3',OLD2='oly-speed-v2',NMAX=300,LIMIT=900000;   /* last 300 samples per combo; localStorage text kept under ~0.9 M chars */
const fresh=()=>({v:4,m:{},seen:{},def:{}});
/* «already counted» keys are stored as a 2×32-bit hash (≤14 chars) instead of the long ids */
function hk(x){let a=0x811c9dc5,b=0x9e3779b9;for(let i=0;i<x.length;i++){const c=x.charCodeAt(i);a=Math.imul(a^c,16777619);b=Math.imul(b^c,0x85ebca6b)^(b>>>15)}return (a>>>0).toString(36)+'.'+(b>>>0).toString(36)}
const rows=(a,n)=>Array.isArray(a)?a.filter(e=>Array.isArray(e)&&e.length>=n&&e.slice(0,n).every(v=>typeof v==='number'&&isFinite(v))).slice(-NMAX):[];
const nums=a=>Array.isArray(a)?a.filter(n=>typeof n==='number'&&n>=0).slice(-NMAX):[];
const cleanX=b=>({r:rows(b&&b.r,3).map(e=>[e[0],e[1],e[2],e[3]==='a'?'a':'s']),g:rows(b&&b.g,3),t:rows(b&&b.t,4),f:nums(b&&b.f)});
/* v2/v3 bucket {d,i,r,g,t,f,c} → v4 model {d,i,c,x:{'|':{r,g,t,f}}} (v2 r rows: Claude stream samples → 's') */
function migrate(x){if(!x||typeof x!=='object'||!x.m||typeof x.m!=='object')return null;
 const o={v:4,m:{},seen:{},def:{}};
 if(x.seen&&typeof x.seen==='object')for(const k in x.seen)o.seen[/^[0-9a-z]{1,7}\.[0-9a-z]{1,7}$/.test(k)?k:hk(k)]=1;
 if(x.def&&typeof x.def==='object')for(const k in x.def)if(typeof x.def[k]==='string')o.def[k]=x.def[k];
 for(const k in x.m){const b=x.m[k];if(!b||typeof b!=='object')continue;
  const m={d:typeof b.d==='string'?b.d:'',i:typeof b.i==='string'?b.i:'',c:typeof b.c==='number'&&b.c>0?b.c:1,x:{}};
  if(x.v===4&&b.x&&typeof b.x==='object'){for(const ck in b.x)if(typeof ck==='string'&&ck.indexOf('|')>=0)m.x[ck]=cleanX(b.x[ck])}
  else{const c=cleanX(b);if(c.r.length+c.g.length+c.t.length+c.f.length)m.x['|']=c}
  o.m[k]=m}
 return o}
let dirty=false,ver=1;
let S=(()=>{try{const x=JSON.parse(LS(KEY));if(x&&x.v===4){const y=migrate(x);if(y)return y}}catch(e){}
 for(const k of[OLD3,OLD2])try{const x=JSON.parse(LS(k));if(x&&(x.v===3||x.v===2)){const y=migrate(x);if(y){dirty=true;return y}}}catch(e){}
 return fresh()})();
const M=id=>S.m[id]||(S.m[id]={d:'',i:'',c:1,x:{}});
const X=(id,ck)=>{const m=M(id);return m.x[ck]||(m.x[ck]={r:[],g:[],t:[],f:[]})};
const push=(a,x)=>{a.push(x);if(a.length>NMAX)a.splice(0,a.length-NMAX)};
const touch=()=>{dirty=true;ver++};
function save(){if(!dirty)return;dirty=false;const ks=Object.keys(S.seen);if(ks.length>3000)for(const k of ks.slice(0,ks.length-2000))delete S.seen[k];
 let j=JSON.stringify(S);
 for(const[n,keys]of[[100,'gt'],[150,'rf'],[40,'gt'],[60,'rf'],[20,'gtrf']])if(j.length>LIMIT){for(const id in S.m)for(const ck in S.m[id].x){const x=S.m[id].x[ck];for(const k of keys)if(x[k].length>n)x[k]=x[k].slice(-n)}j=JSON.stringify(S)}
 LS(KEY,j)}
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
const items=new Map();      // itemId → {type,turn,thread,run,a,b,len}
const turnItems=new Map();  // turnId → Set(itemRec)
const turns=new Map();      // turnId → {status,t0,t1,tm,um,driver,att,thread,usage,ws,reqs[],live}
const runs=new Map();       // runId → {model,inst,thread,ck}
const atts=new Map();       // attemptId → runId
const rqs=new Map();        // turnId → Map(requestId → [createdMs,resolvedMs])  approvals / questions
const textPts=new Map();    // threadId → [[serverMs,localMs,cumEstTokens]]
const lastReq=new Map();    // threadId → {model,ck,v,exact,at}
const subSel=new Map();     // child threadId → provider-reported subagent modelSelection
const liveUse=new Map();    // threadId → request with live usage points (q.pts)
const threadModel=new Map();// threadId → model id (latest turn)
const OUT={assistant_message:1,reasoning:1};                         /* streamed model output */
const FREE={user_message:1,system_notice:1,error:1,plan:1};           /* neither output nor waiting */
const SEP={opencode:1};                     /* tokenUsage.outputTokens excludes reasoningOutputTokens */
const INCL={claudeAgent:1,codex:1};         /* outputTokens include reasoning */
const NO_REASON_ANCHOR={codex:1};           /* reasoning item starts with the request (before TTFT): not an anchor */
const MINTOK=80,MINMS=500;   /* exact sample: ≥80 tokens over ≥0.5 s (shorter windows are dominated by chunk timing) */
const STREAM_ONLY={pi:1};                   /* single usage points are session totals */
const UNSPLIT={};   /* drivers whose answers may start with hidden reasoning that is counted in outputTokens: none known.
   Claude: provider logs show every thinking block arrives with text (T3 creates a reasoning item), so an answer whose
   first item is text really started without thinking; message_start → first content_block_start = 0 ms (p95 1 ms).
   Tool items are never anchors: T3 creates them when the tool input is complete — Claude tool_use-first answers:
   item start − content_block_start median 1.6 s, window within 2 % of message_start→message_delta in 0.1 % of 2970. */
const D=s=>{const t=s?Date.parse(s):NaN;return t>0?t:NaN};
const R=(x,c)=>typeof x==='number'?(c.ids&&c.ids[x]!=null?String(c.ids[x]):'#'+x):x==null?null:String(x);
const turnOf=id=>turns.get(id);
/* reasoning level / speed mode of a selection (same option ids and tier map as T3's ProviderUsageAnalytics) */
const EFF_IDS=['reasoningEffort','effort','variant','reasoning','reasoning_effort','thinking_level','thinkingLevel','thought_level','thinking'];
const TIERS={default:'std',standard:'std',normal:'std',flex:'flex',fast:'fast',priority:'fast',ultrafast:'ultra'};
const normEff=v=>{const x=String(v).trim().toLowerCase().replace(/[\s_-]+/g,'');return x==='extrahigh'?'xhigh':x};
const defOf=(kind,inst,model)=>model==null?undefined:S.def[kind+'|'+(inst||'')+'|'+model]||S.def[kind+'|*|'+model];
function comboOf(sel,inst,model){if(!sel||typeof sel!=='object')return '|';const op=Array.isArray(sel.options)?sel.options:[];
 inst=inst||(sel.instanceId!=null?String(sel.instanceId):'');model=model||(sel.model!=null?String(sel.model):null);
 const g=id=>{for(const o of op)if(o&&o.id===id)return o.value};let e='',t='std';
 for(const id of EFF_IDS){const v=g(id);if(typeof v==='string'&&v.trim()){e=normEff(v);break}}
 if(!e)e=defOf('e',inst,model)||'';
 const st=g('serviceTier'),fm=g('fastMode');if(typeof st==='string'&&st.trim()){const k=st.trim().toLowerCase();t=TIERS[k]||k}else if(fm===true)t='fast';else if(fm!==false)t=defOf('t',inst,model)||'std';
 return e.replace(/\|/g,'')+'|'+t.replace(/\|/g,'')}

function addPt(th,st,e){if(!th)return;let p=textPts.get(th);if(!p){p=[];textPts.set(th,p)}
 const cum=(p.length?p[p.length-1][2]:0)+e;p.push([st,performance.now(),cum]);while(p.length>2&&p[p.length-1][0]-p[0][0]>30000)p.shift()}
function onItem(it,c){const id=R(it.id,c);if(!id)return;const turn=R(it.providerTurnId,c);
 let r=items.get(id),isNew=false;if(!r){r={len:0};items.set(id,r);isNew=true}
 r.type=it.type;r.thread=R(it.threadId,c)||c.thread||r.thread;r.a=D(it.startedAt);r.b=D(it.completedAt);if(it.runId!=null)r.run=R(it.runId,c);
 if(turn&&turn!==r.turn){r.turn=turn;let s=turnItems.get(turn);if(!s){s=new Set();turnItems.set(turn,s)}s.add(r)}
 if(OUT[it.type]&&typeof it.text==='string'){const L=it.text.length;
  if(it.streaming===true){const st=D(it.updatedAt)||Date.now();
   if(isNew||L<r.len)addPt(r.thread,st,0);else if(L>r.len)addPt(r.thread,st,estTok(it.text.slice(r.len)))}
  if(L>=r.len||it.streaming!==true)r.len=L}}
function onRun(o,c){const id=R(o.id,c);if(!id)return;const ms=o.modelSelection;
 runs.set(id,{model:String(ms.model),inst:R(o.providerInstanceId,c)||(ms.instanceId!=null?String(ms.instanceId):''),thread:R(o.threadId,c)||c.thread,sel:ms})}
function onReq(o,c){const turn=R(o.providerTurnId,c),id=R(o.id,c);if(!turn||!id)return;let m=rqs.get(turn);if(!m){m=new Map();rqs.set(turn,m)}m.set(id,[D(o.createdAt),D(o.resolvedAt)])}
function runOf(id,T){let r=T.att&&runs.get(atts.get(T.att));if(r)return r;const s=turnItems.get(id);if(s)for(const x of s){if(x.run&&(r=runs.get(x.run)))return r}return null}
function modelOf(id,T){if(T.tm)return T.tm;if(T.um)return T.um;const r=runOf(id,T);if(r&&r.model)return r.model;const ss=T.thread&&subSel.get(T.thread);return ss&&ss.model!=null?String(ss.model):null}
function thOf(id,T){if(!T.thread){const s=turnItems.get(id);if(s)for(const r of s)if(r.thread){T.thread=r.thread;break}if(!T.thread){const r=runOf(id,T);if(r&&r.thread)T.thread=r.thread}}return T.thread}
function ckOf(id,T){const r=runOf(id,T);if(r)return comboOf(r.sel,r.inst,r.model);const th=thOf(id,T),ss=th&&subSel.get(th);return ss?comboOf(ss):'|'}
/* provider snapshot: default level / mode per instance+model */
function onProvider(o,c){const inst=R(o.instanceId,c)||'';let ch=false;
 const set=(k,v)=>{if(v&&S.def[k]!==v){S.def[k]=v;ch=true}};
 for(const m of o.models){if(!m||typeof m.slug!=='string')continue;const ds=m.capabilities&&Array.isArray(m.capabilities.optionDescriptors)?m.capabilities.optionDescriptors:[];
  for(const d of ds){if(!d||d.type!=='select'||!Array.isArray(d.options))continue;const df=d.options.find(x=>x&&x.isDefault===true);if(!df||df.id==null)continue;
   if(EFF_IDS.indexOf(d.id)>=0||d.role==='reasoning'){const e=normEff(df.id).replace(/\|/g,'');set('e|'+inst+'|'+m.slug,e);set('e|*|'+m.slug,e)}
   else if(d.id==='serviceTier'){const k=String(df.id).toLowerCase(),t=(TIERS[k]||k).replace(/\|/g,'');set('t|'+inst+'|'+m.slug,t);set('t|*|'+m.slug,t)}}}
 if(ch){remap();touch()}}
/* '|<mode>' samples (level missing in the selection) → '<default>|<mode>' once the default is known */
const byTime=(a,i)=>a.sort((x,y)=>x[i]-y[i]).slice(-NMAX);
function remap(){let ch=false;for(const id in S.m){const B=S.m[id];for(const ck in B.x){if(ck[0]!=='|'||ck==='|')continue;const e=defOf('e',B.i,id);if(!e)continue;
  const from=B.x[ck],to=X(id,e+ck);to.r=byTime(to.r.concat(from.r),2);to.g=byTime(to.g.concat(from.g),2);to.t=byTime(to.t.concat(from.t),3);to.f=to.f.concat(from.f).slice(-NMAX);
  delete B.x[ck];ch=true}}
 if(ch)touch();return ch}
remap();   /* defaults saved earlier */
function meta(B,id,T){if(T.driver)B.d=T.driver;const r=runOf(id,T);if(r&&r.inst)B.i=r.inst}
const covered=T=>!(T.ws===Infinity||(T.ws>0&&T.t0<T.ws));  /* items window covers the whole turn */

function onTurn(t,c){const id=R(t.id,c);if(!id)return;let T=turns.get(id);if(!T){T={reqs:[],live:false};turns.set(id,T)}
 T.status=t.status||T.status;T.t0=D(t.startedAt);T.t1=D(t.completedAt);
 const tu=t.turnTokenUsage;if(tu)T.usage=tu;
 if(t.model)T.tm=t.model;if(tu&&Array.isArray(tu.models)&&tu.models.length===1&&tu.models[0])T.um=tu.models[0];
 T.driver=(t.nativeTurnRef&&t.nativeTurnRef.driver)||T.driver;if(t.runAttemptId!=null)T.att=R(t.runAttemptId,c);
 if(c.ws!==undefined)T.ws=c.ws;if(c.thread&&!T.thread)T.thread=c.thread;
 thOf(id,T);
 const running=t.status==='running';if(running)T.live=true;
 const u=t.tokenUsage;if(u&&typeof u.outputTokens==='number'){const ut=D(u.updatedAt);if(ut>0){
  const ro=typeof u.reasoningOutputTokens==='number'?u.reasoningOutputTokens:0;
  const rk=(u.inputTokens|0)+'|'+(u.cachedInputTokens|0);let q=T.reqs[T.reqs.length-1];
  if(!q||q.k!==rk){const prev=q;if(prev&&!prev.done)done(id,prev);
   q={k:rk,o0:u.outputTokens,t0:ut,o1:u.outputTokens,t1:ut,r1:ro,n:1,live:running,prevEnd:prev&&prev.live?prev.t1:0,done:false,pts:[[ut,performance.now(),u.outputTokens]]};
   T.reqs.push(q);if(T.reqs.length>300)T.reqs.shift()}
  else if(u.outputTokens>q.o1&&ut>=q.t1){q.o1=u.outputTokens;q.t1=ut;q.r1=ro;q.n++;if(running){q.live=true;push(q.pts,[ut,performance.now(),u.outputTokens])}}
  if(running&&T.thread)liveUse.set(T.thread,q)}}
 if(t.status&&!running){const q=T.reqs[T.reqs.length-1];if(q&&!q.done)done(id,q)}
 if(T.thread){const m=modelOf(id,T);if(m)threadModel.set(T.thread,m)}
 pendingTurns.add(id)}
const pendingTurns=new Set(),pendingReqs=[];
function done(id,q){q.done=true;pendingReqs.push([id,q])}

/* request start: latest of previous request end / tool·subagent·approval end / turn start, and the request's first
   streamed output after it. Tools that start after an output seen since the previous request belong to this request. */
function bound(id,T,q,extra){const s=turnItems.get(id),outs=[],ev=[],ws=T.ws>0&&T.ws<Infinity?T.ws:0;
 if(s)for(const r of s){if(!(r.a>0))continue;if(OUT[r.type])outs.push(r);else if(!FREE[r.type]&&r.b>0&&r.b<q.t1&&r.b>=ws&&T.ws!==Infinity)ev.push([r.b,r.a])}
 const m=rqs.get(id);if(m)for(const x of m.values())if(x[1]>0&&x[1]<q.t1&&x[1]>=ws&&T.ws!==Infinity)ev.push([x[1],x[0]]);
 if(q.prevEnd>0)ev.push([q.prevEnd,-Infinity]);
 if(T.t0>0&&covered(T))ev.push([T.t0,-Infinity]);
 ev.sort((x,y)=>y[0]-x[0]);
 for(const[b,a]of ev){if(b<=0)continue;
  if(q.prevEnd>0&&b>q.prevEnd&&outs.some(r=>r.a>q.prevEnd&&r.a<a))continue;  /* own tool of this request */
  let ra=Infinity,ta=Infinity;for(const r of outs)if(r.a>b&&r.a<=q.t1+50){if(r.type==='reasoning'){if(r.a<ra)ra=r.a}else if(r.a<ta)ta=r.a}
  return{lo:b,ra,ta,first:Math.min(ra,ta,extra>b?extra:Infinity)}}
 return null}
function calib(B,th,a,b,tok){const p=th&&textPts.get(th);if(!p||p.length<2)return;let x=null,y=null;
 for(const e of p){if(e[0]<=a+200)x=e;if(e[0]<=b+400)y=e}
 if(x&&y&&y[2]>x[2]){const k=tok/(y[2]-x[2]);if(k>.4&&k<2.5)B.c=Math.min(1.8,Math.max(.6,(B.c||1)*.85+k*.15))}}
function fin(id,q){const T=turnOf(id);if(!T)return;const model=modelOf(id,T);if(!model)return;
 const key=hk('q|'+id+'|'+q.k+'|'+q.o1);if(S.seen[key])return;
 const B=M(model),ck=ckOf(id,T),C=X(model,ck),dr=T.driver||'',now=Date.now();let v=null,exact=false;
 if(q.n>=2){const dTok=dr==='claudeAgent'&&q.o0<=40?q.o1:q.o1-q.o0,dt=q.t1-q.t0;if(!(dTok>=MINTOK&&dt>=MINMS))return;v=dTok/dt*1000;if(!(v>1&&v<5000))return;
  push(C.r,[dTok,Math.round(dt),now,'s']);exact=true;
  if(q.o0<=40){const w=bound(id,T,q,q.t0);if(w&&w.first===q.t0){const f=q.t0-w.lo;if(f>=0&&f<120000)push(C.f,Math.round(f))}}
  calib(B,T.thread,q.t0,q.t1,dTok)}
 else{if(STREAM_ONLY[dr])return;
  const tot=q.o1,rs=Math.max(0,q.r1|0),sep=SEP[dr]||(!INCL[dr]&&rs>tot);
  const vis=sep?tot:Math.max(0,tot-rs),hid=sep?rs:Math.min(rs,tot),all=vis+hid;
  const tu=T.usage;if(tu&&tu.outputTokens>0&&all>tu.outputTokens+(SEP[dr]?0:(tu.reasoningTokens|0))+5)return; /* not a per-request count */
  const w=bound(id,T,q);if(!w)return;let tok=0,a=Infinity,pre=0;
  if(w.ra<Infinity&&w.ra<=w.ta&&!NO_REASON_ANCHOR[dr]){tok=all;a=w.ra}
  else if(w.ta<Infinity&&!UNSPLIT[dr]){tok=vis;a=w.ta;pre=hid}
  /* Claude: blocks of one message follow each other without a pause; a gap > 1 s between output items means an
     earlier request whose boundary left no tool item (hidden tool, background subagent) → anchor on the last
     contiguous chain of output items before the end */
  if(dr==='claudeAgent'&&a<Infinity){const s=turnItems.get(id),ch=[];if(s)for(const r of s)if(OUT[r.type]&&r.a>=a&&r.a<=q.t1+50)ch.push(r);ch.sort((x,y)=>x.a-y.a);
   let k=ch.length-1;while(k>0&&ch[k-1].b>0&&ch[k].a-ch[k-1].b<=1000)k--;if(k>0){a=ch[k].a;w.lo=NaN}}
  /* Codex: item times are Codex's own (startedAtMs/completedAtMs), tokenUsage.updatedAt is T3's receive time
     (+0.1–0.25 s). End the window at the request's last output in Codex time: text completion or a tool call start. */
  let end=q.t1;if(dr==='codex'&&a<Infinity){let e=0;const s=turnItems.get(id);if(s)for(const r of s){if(!(r.a>=a)||r.a>q.t1)continue;const x=OUT[r.type]?r.b:FREE[r.type]?0:r.a;if(x>e&&x<=q.t1)e=x}
   if(e>a&&q.t1-e<1500)end=e}
  const ms=end-a;
  if(tok>=MINTOK&&ms>=MINMS&&tok/ms*1000<5000&&tok/ms*1000>1){v=tok/ms*1000;exact=true;push(C.r,[tok,Math.round(ms),now,'a']);
   const f=(a-w.lo)-(pre>0?pre/v*1000:0);if(f>=0&&f<120000&&(pre===0||f>=150))push(C.f,Math.round(f));
   calib(B,T.thread,a,q.t1,tok)}
  else{const g=q.t1-w.lo;if(!(all>=30&&g>=1000&&g<600000&&all/g*1000<3000))return;push(C.g,[all,Math.round(g),now]);
   const L=ttft(model,ck);v=all/Math.max(g-L,g*.35)*1000}}
 S.seen[key]=1;meta(B,id,T);touch();thOf(id,T);
 if(T.thread){threadModel.set(T.thread,model);const o=lastReq.get(T.thread);if(!o||o.at<=q.t1)lastReq.set(T.thread,{model,ck,v,exact,at:q.t1})}}

function busy(id,T,end){const iv=[];const s=turnItems.get(id);
 if(s)for(const r of s){if(OUT[r.type]||FREE[r.type]||!(r.a>0))continue;iv.push([r.a,r.b>0?r.b:end])}
 const m=rqs.get(id);if(m)for(const x of m.values())if(x[0]>0)iv.push([x[0],x[1]>0?x[1]:end]);return iv}
function evalTurn(id){const T=turns.get(id);if(!T||T.status!=='completed')return;const u=T.usage,model=modelOf(id,T);
 if(model&&thOf(id,T))threadModel.set(T.thread,model);
 if(!u||u.usageStatus!=='complete'||!(u.outputTokens>0)||!(T.t1>T.t0)||!model)return;
 const key=hk(model+'|'+T.t0+'|'+u.outputTokens);if(S.seen[key])return;
 if(!covered(T))return;
 const s=turnItems.get(id);if(!s||!s.size)return;let nText=0,first=Infinity;
 for(const r of s){if(r.a<first)first=r.a;if(OUT[r.type])nText++}
 if(!nText||first-T.t0>120000)return;
 const iv=busy(id,T,T.t1).map(([a,b])=>[Math.max(T.t0,a),Math.min(T.t1,b)]).filter(x=>x[1]>x[0]);
 iv.sort((x,y)=>x[0]-y[0]);let bt=0,blocks=0,ca=-1,cb=-1;for(const[a,b]of iv){if(a>cb){if(cb>ca){bt+=cb-ca;blocks++}ca=a;cb=b}else if(b>cb)cb=b}if(cb>ca){bt+=cb-ca;blocks++}
 const gen=(T.t1-T.t0)-bt;if(gen<1500)return;
 const out=u.outputTokens+((u.reasoningTokens|0)>u.outputTokens?u.reasoningTokens|0:0);
 S.seen[key]=1;const B=M(model);meta(B,id,T);push(X(model,ckOf(id,T)).t,[out,Math.round(gen),blocks+1,Date.now()]);touch()}

/* ---- frame parsing ---- */
function walk(o,c,d){if(!o||typeof o!=='object'||d>14)return;
 if(Array.isArray(o)){for(const x of o)walk(x,c,d+1);return}
 const p=o.projection&&typeof o.projection==='object'?o.projection:null,cmp=Array.isArray(o.ids)&&o.ids.length&&typeof o.ids[0]==='string';
 if(cmp||(p&&p.thread)){c={ids:cmp?o.ids:null,thread:c.thread};   /* snapshot / history page (compact ids or plain) */
  if(p&&p.thread&&p.thread.id!=null)c.thread=R(p.thread.id,c);
  if(o.hasMoreHistory===true){let ws=Infinity;for(const v of (p&&p.visibleTurnItems)||[]){const t=D(v&&v.item&&v.item.startedAt);if(t<ws)ws=t}c.ws=ws}else if(o.hasMoreHistory===false)c.ws=0}
 if(o.event&&typeof o.event==='object'&&typeof o.event.threadId==='string')c={ids:null,thread:o.event.threadId};
 if(o.item&&typeof o.item==='object'&&typeof o.item.type==='string'&&'providerTurnId' in o.item)onItem(o.item,c);
 else if(typeof o.type==='string'&&'providerTurnId' in o&&'ordinal' in o)onItem(o,c);
 if(o.modelSelection&&typeof o.modelSelection==='object'&&o.modelSelection.model!=null&&'activeAttemptId' in o)onRun(o,c);
 if(Array.isArray(o.models)&&o.driver!=null&&o.instanceId!=null)onProvider(o,c);
 if(o.childThreadId!=null&&o.modelSelection&&typeof o.modelSelection==='object')subSel.set(R(o.childThreadId,c),o.modelSelection);
 if('attemptOrdinal' in o&&o.runId!=null&&o.id!=null)atts.set(R(o.id,c),R(o.runId,c));
 if(o.nativeRequestRef&&'createdAt' in o&&o.providerTurnId!=null)onReq(o,c);
 if(o.nativeTurnRef&&'startedAt' in o&&('tokenUsage' in o||'turnTokenUsage' in o||'runAttemptId' in o))onTurn(o,c);
 for(const k in o){if(k==='item'||k==='ids')continue;const v=o[k];if(v&&typeof v==='object')walk(v,c,d+1)}}
const dbg=globalThis.__olySpeed={frames:0,parsed:0,items,turns,runs,atts,textPts,lastReq,est:estTok,get S(){return S}};
function feed(data){dbg.frames++;if(typeof data!=='string'||data.length<60)return;
 if(data.indexOf('providerTurnId')<0&&data.indexOf('okenUsage')<0&&data.indexOf('activeAttemptId')<0&&data.indexOf('childThreadId')<0&&data.indexOf('optionDescriptors')<0)return;
 try{dbg.parsed++;walk(JSON.parse(data),{ids:null,thread:null},0);
  for(const[id,q]of pendingReqs.splice(0))fin(id,q);for(const id of pendingTurns)evalTurn(id);pendingTurns.clear()}catch(e){dbg.err=String(e)}}
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
const med=a=>a.length?qtl(a.slice().sort((x,y)=>x-y),.5):NaN;
/* combos of a model: sel null = all, 'level|mode' = one, function(ck) = filter */
const xsOf=(B,sel)=>{const out=[];if(B&&B.x)for(const ck in B.x)if(sel==null||(typeof sel==='function'?sel(ck):ck===sel))out.push(B.x[ck]);return out};
const fsOf=xs=>[].concat(...xs.map(x=>x.f||[]));
function ttft(id,ck){const B=S.m[id];let v=ck!=null?med(fsOf(xsOf(B,ck))):NaN;if(v>=0)return v;v=med(fsOf(xsOf(B)));if(v>=0)return v;
 const d=B&&B.d,all=[];for(const k in S.m)if(S.m[k].d===d)all.push(...fsOf(xsOf(S.m[k])));return all.length?med(all):1200}
function modelSpeed(id,sel){const B=S.m[id],xs=xsOf(B,sel);if(!xs.length)return null;const f=med(fsOf(xs)),L=f>=0?f:ttft(id);
 const r=[].concat(...xs.map(x=>x.r));
 if(r.length>=3){const s=robust(r.map(x=>({tok:x[0],ms:x[1]})));if(s)return Object.assign(s,{method:'exact',ttft:f,d:B.d,c:B.c})}
 const list=r.map(x=>({tok:x[0],ms:x[1]}))
  .concat(...xs.map(x=>x.g.map(y=>({tok:y[0],ms:Math.max(y[1]-L,y[1]*.35)}))))
  .concat(...xs.map(x=>x.t.map(y=>({tok:y[0],ms:Math.max(y[1]-y[2]*L,y[1]*.35)}))));
 const s=robust(list);return s?Object.assign(s,{method:'est',ttft:f,d:B.d,c:B.c}):null}
const nSamples=B=>xsOf(B).reduce((a,x)=>a+x.r.length+x.g.length+x.t.length,0);
const norm=s=>String(s||'').toLowerCase().replace(/<[^>]*>/g,'').replace(/[^a-z0-9а-яё]+/g,'-').replace(/^-+|-+$/g,'');
function findModel(name){const n=norm(name);if(!n)return null;if(S.m[name])return name;let best=null,bn=-1;
 for(const k in S.m){const kn=norm(k);if(kn===n||kn.endsWith('-'+n)||n.endsWith('-'+kn)||kn.replace(/^(claude|gpt|openai|anthropic)-/,'')===n.replace(/^(claude|gpt|openai|anthropic)-/,'')){const cnt=nSamples(S.m[k]);if(cnt>bn){bn=cnt;best=k}}}
 return best}
const fmt=v=>v==null||!isFinite(v)?'—':v>=100?Math.round(v).toString():v.toFixed(1).replace('.',',');
const fmtS=ms=>!(ms>=0)?'—':(ms/1000).toFixed(ms<10000?1:0).replace('.',',')+' с';
const sp=(v,exact)=>(exact?'':'≈ ')+fmt(v);
const PROV={claudeAgent:'Claude',claude:'Claude',codex:'Codex',openrouter:'OpenRouter',opencode:'OpenCode',gemini:'Gemini',cursor:'Cursor',pi:'Pi',muse:'Muse',kiro:'Kiro',grok:'Grok',antigravity:'Antigravity',acpRegistry:'ACP',fx:'FX'};
const prov=B=>PROV[B.i]||PROV[B.d]||(B.i||B.d?String(B.i||B.d)[0].toUpperCase()+String(B.i||B.d).slice(1):'Другие');
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const plural=(n,a,b,c)=>{const m10=n%10,m100=n%100;return n+' '+(m10===1&&m100!==11?a:m10>=2&&m10<=4&&(m100<10||m100>=20)?b:c)};
/* levels and modes: labels as in the Russian UI */
const EFF_RU={none:'Нет',minimal:'Минимальный',low:'Низкий',medium:'Средний',high:'Высокий',xhigh:'Очень высокий',max:'Максимум',ultra:'Ultra',ultrathink:'Ultrathink',ultracode:'Ultracode'};
const TIER_RU={std:'Стандарт',fast:'Быстро',ultra:'Сверхбыстро',flex:'Flex'};
const EFF_ORD=['none','minimal','low','medium','high','xhigh','max','ultra','ultrathink','ultracode'],TIER_ORD=['std','fast','ultra','flex'];
const effLabel=e=>e?EFF_RU[e]||e:'уровень не указан',tierLabel=t=>t?TIER_RU[t]||t:'режим не указан';
const ckSplit=ck=>{const i=ck.indexOf('|');return i<0?[ck,'']:[ck.slice(0,i),ck.slice(i+1)]};
const ckLabel=ck=>{const[e,t]=ckSplit(ck);return effLabel(e)+' · '+tierLabel(t)};
const ordIdx=(a,v)=>v===''?999:a.indexOf(v)<0?500:a.indexOf(v);
function combos(id){const out=[];const B=S.m[id];if(B)for(const ck in B.x){const s=modelSpeed(id,ck);if(s){const[e,t]=ckSplit(ck);out.push({ck,e,t,s})}}
 return out.sort((a,b)=>ordIdx(EFF_ORD,a.e)-ordIdx(EFF_ORD,b.e)||a.e.localeCompare(b.e)||ordIdx(TIER_ORD,a.t)-ordIdx(TIER_ORD,b.t)||a.t.localeCompare(b.t))}
const showCombos=list=>list.length>1||(list.length===1&&list[0].ck!=='|');
/* UI text (Russian or English option labels) → level / mode id */
function effFromText(s){s=String(s||'').toLowerCase().trim();if(!s)return null;
 if(/extra\s*high|очень\s*высок|\bxhigh\b/.test(s))return'xhigh';if(/ultrathink/.test(s))return'ultrathink';if(/ultracode/.test(s))return'ultracode';
 if(/\bmax\b|максим/.test(s))return'max';if(/\bhigh\b|высок/.test(s))return'high';if(/\bmedium\b|средн/.test(s))return'medium';
 if(/\bminimal\b|минимал/.test(s))return'minimal';if(/\blow\b|низк/.test(s))return'low';if(/^(none|нет)$/.test(s))return'none';if(/\bultra\b/.test(s))return'ultra';return null}
function tierFromText(s){s=String(s||'').toLowerCase();if(/ultrafast|сверхбыстр/.test(s))return'ultra';if(/\bfast\b|\bpriority\b|быстр/.test(s))return'fast';
 if(/\bflex\b/.test(s))return'flex';if(/standard|стандарт|\bdefault\b|по умолчанию|\bnormal\b|обычн/.test(s))return'std';return null}
const meth=s=>s.method==='exact'?'точно':'оценка';
const desc=s=>fmt(s.v)+' ток/с — '+meth(s)+', '+plural(s.n,'замер','замера','замеров')+(s.ttft>=0?', первый токен '+fmtS(s.ttft):'');

/* ---- live ---- */
/* exact: provider usage points during the request (Pi streams them; Claude only start/end → not live) */
function liveExact(th){const q=th&&liveUse.get(th);if(!q||q.done||!q.pts||q.pts.length<3)return null;const p=q.pts,last=p[p.length-1];
 if(performance.now()-last[1]>4500)return null;let a=null;for(const x of p){if(last[0]-x[0]<=9000){a=x;break}}
 if(!a||a===last||last[0]-a[0]<1200||last[2]<=a[2])return null;return (last[2]-a[2])/(last[0]-a[0])*1000}
/* estimate: text growth, pauses (>1.5 s: TTFT, tools) left out */
function liveRate(th){const p=th&&textPts.get(th);if(!p||p.length<2)return null;const last=p[p.length-1];if(performance.now()-last[1]>4500)return null;
 let tok=0,ms=0;for(let i=p.length-1;i>0;i--){const x=p[i],y=p[i-1];if(last[0]-y[0]>9000)break;const dt=x[0]-y[0];if(dt<0||dt>1500)continue;tok+=x[2]-y[2];ms+=dt}
 if(ms<1200||tok<=0)return null;const m=threadModel.get(th),c=(m&&S.m[m]&&S.m[m].c)||1;return tok/ms*1000*c}
function curThread(){const seg=location.pathname.split('/').filter(Boolean);if(seg.length<2)return null;try{return decodeURIComponent(seg[seg.length-1])}catch(e){return seg[seg.length-1]}}
/* composer selection now: aria-label «<model>, <level>[ Fast| Ultrafast][ · …]»; no Fast/Ultrafast word ⇒ standard */
function composerSel(host){const b=host&&host.querySelector('button[data-composer-shortcut~="composer.effort"]');const l=b&&(b.getAttribute('aria-label')||b.textContent)||'';
 const i=l.indexOf(','),rest=i<0?'':l.slice(i+1),strip=x=>x.replace(/\b(ultra)?fast\b|сверхбыстр\S*|быстр\S*/gi,'');
 return{model:(i<0?l:l.slice(0,i)).trim(),eff:effFromText(strip(rest.split('·')[0]))||effFromText(strip(rest))||'',tier:/ultrafast|сверхбыстр/i.test(rest)?'ultra':/\bfast\b|быстр/i.test(rest)?'fast':'std'}}
/* DOM writes only when the value changes (idle ticks must not wake MutationObservers) */
const setText=(el,t)=>{if(el.textContent!==t)el.textContent=t};
const setTitle=(el,t)=>{if(el.title!==t)el.title=t};
const setHTML=(el,h)=>{if(el.__olyH!==h){el.innerHTML=h;el.__olyH=h}};
const setData=(el,k,v)=>{if(el.dataset[k]!==v)el.dataset[k]=v};
Object.assign(dbg,{modelSpeed,combos,findModel,liveRate,liveExact,save,comboOf,composerSel,effFromText,tierFromText});

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
.oly-pick-speed{flex-shrink:0;margin-left:auto;padding-left:8px;font-size:11.5px;color:var(--muted-foreground);font-variant-numeric:tabular-nums;white-space:nowrap}
.oly-eff-speed{flex-shrink:0;font-size:11px;line-height:1;color:var(--muted-foreground);font-variant-numeric:tabular-nums;white-space:nowrap;letter-spacing:0}
[aria-checked=true]>.oly-eff-speed{color:var(--foreground)}
@media (min-width:640px){[data-model-picker-effort][data-oly-speed]{width:15rem}}
[data-oly-speed] [data-effort-level]>*{white-space:nowrap}
.oly-seg-speed{margin-left:4px;font-size:10.5px;line-height:1;color:var(--muted-foreground);opacity:.85;white-space:nowrap;font-variant-numeric:tabular-nums;pointer-events:none}
.oly-cmb{margin-top:16px}
.oly-cmb-h{font-size:12px;color:var(--muted-foreground);margin-bottom:6px}
.oly-cmb table{width:100%;border-collapse:collapse;font-size:12.5px;font-variant-numeric:tabular-nums}
.oly-cmb th{text-align:left;font-weight:400;color:var(--muted-foreground);font-size:11.5px;padding:0 10px 5px 0;white-space:nowrap}
.oly-cmb td{padding:5px 10px 5px 0;border-top:1px solid var(--border);white-space:nowrap}
.oly-cmb .num{text-align:right}
.oly-cmb b{font-weight:500}
.oly-cmb .mode,.oly-stats tr.cmb td.cl span{color:var(--muted-foreground)}
.oly-stats .lvl{display:block;margin-top:2px;font-family:inherit;font-size:11.5px;line-height:1.3;color:var(--muted-foreground)}
.oly-stats tr.cmb td{padding-top:4px;padding-bottom:4px;font-size:12px;border-top-style:dashed}
.oly-stats tr.cmb td.cl{padding-left:14px}
.oly-stats tr.cmb .oly-spark{height:16px}`;
(document.head||document.documentElement).appendChild(css);

/* ---- composer chip: speed of the selected model + level + mode ---- */
const ICON_BOLT='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>';
function chip(){const host=document.querySelector('[data-slot=composer-host]');if(!host)return;
 let el=host.querySelector('.oly-speed');
 if(!el){const plan=host.querySelector('.oly-plan'),anchor=plan||host.querySelector('button[data-composer-shortcut~="composer.effort"]');if(!anchor||!anchor.parentElement)return;
  el=document.createElement('span');el.className='oly-chip oly-speed';el.innerHTML=ICON_BOLT+'<span></span>';anchor.parentElement.insertBefore(el,anchor)}
 const th=curThread(),le=liveExact(th),live=le==null?liveRate(th):null,lr=th&&lastReq.get(th),sel=composerSel(host),cm=findModel(sel.model),ck=sel.eff+'|'+(segTier(segGroups())||sel.tier);
 const cs=cm&&modelSpeed(cm,ck),ms=cm&&modelSpeed(cm),lrOk=lr&&Date.now()-lr.at<15*60e3&&(!cm||(lr.model===cm&&lr.ck===ck));
 let txt,title,isLive=false;
 if(le!=null){isLive=true;txt=fmt(le)+' ток/с';title='Скорость генерации сейчас — точно, по счётчику токенов провайдера.'}
 else if(live!=null){isLive=true;txt='≈ '+fmt(live)+' ток/с';title='Скорость генерации сейчас — оценка по потоку текста (точный счётчик провайдер присылает только в конце запроса), откалибрована по точным замерам.'}
 else if(lrOk){txt=sp(lr.v,lr.exact)+' ток/с';title='Последний запрос в этом треде ('+lr.model+', '+ckLabel(lr.ck)+'): '+fmt(lr.v)+' ток/с — '+(lr.exact?'точно, по счётчику токенов провайдера, без ожидания первого токена и инструментов.':'оценка.')}
 else if(cs){txt=sp(cs.v,cs.method==='exact')+' ток/с';title='Средняя скорость '+cm+' · '+ckLabel(ck)+'.'}
 else if(ms){txt=sp(ms.v,ms.method==='exact')+' ток/с';title='Для «'+ckLabel(ck)+'» замеров пока нет — показана скорость '+cm+' в целом, по всем уровням и режимам.'}
 if(cs)title+='\n'+ckLabel(ck)+': '+desc(cs);
 if(ms)title+='\n'+cm+' в целом: '+desc(ms);
 const disp=txt?'':'none';if(el.style.display!==disp)el.style.display=disp;if(!txt)return;if(el.dataset.live!==String(isLive))el.dataset.live=String(isLive);
 if(el.lastChild.textContent!==txt)el.lastChild.textContent=txt;if(el.title!==title)el.title=title}

/* ---- model picker, «Рассуждение» column: speed per level, fast-mode switch, speed-mode menu ---- */
function tag(row,after,s,title){let t=null;for(const c of row.children)if(c.classList.contains('oly-eff-speed')){t=c;break}
 if(!s||!after||after.parentElement!==row){if(t)t.remove();return}
 if(!t){t=document.createElement('span');t.className='oly-eff-speed';after.after(t)}
 setText(t,sp(s.v,s.method==='exact')+' ток/с');setTitle(t,title)}
/* «Уровень сервиса» segments (Codex): radiogroup outside the level column whose radios are speed modes */
const segLabel=b=>{let t='';for(const n of b.childNodes)if(!(n.classList&&n.classList.contains('oly-seg-speed')))t+=n.textContent;return t};
function segGroups(){const out=[];for(const g of document.querySelectorAll('[role=radiogroup]')){if(g.closest('[data-model-picker-effort]'))continue;
  const bs=[...g.querySelectorAll('[role=radio]')].map(b=>[b,tierFromText(segLabel(b))]);if(bs.length<2||bs.some(x=>!x[1])||!bs.some(x=>x[1]!=='std'))continue;out.push(bs)}
 return out}
const segTier=gs=>{for(const bs of gs)for(const[b,t]of bs)if(b.getAttribute('aria-checked')==='true')return t;return null};
const rowLabel=row=>{const l=row.querySelector('.flex-1');return[l,l?(l.firstElementChild||l).textContent:'']};
function ensureEffort(){const panels=document.querySelectorAll('[data-model-picker-effort]');if(!panels.length&&!document.querySelector('[role=radiogroup] [role=radio]'))return;
 const host=document.querySelector('[data-slot=composer-host]'),cur=host?composerSel(host):null,any=Object.keys(S.m).length>0,gs=segGroups(),st=segTier(gs);let id=null,eff=null;
 for(const p of panels){if(any)setData(p,'olySpeed','1');   /* fixed wider column: no jump when hovering models */
  const hd=p.querySelector('.ms-auto');id=findModel(hd?hd.textContent.trim():'')||(cur&&findModel(cur.model));eff=null;
  const tier=st||(cur?cur.tier:null),rg=p.querySelector('[role=radiogroup]');
  if(rg)for(const row of rg.querySelectorAll('[data-effort-level]')){const[l,txt]=rowLabel(row),e=effFromText(txt);if(e&&row.getAttribute('aria-checked')==='true')eff=e;
   const s=id&&e?modelSpeed(id,tier?e+'|'+tier:ck=>ckSplit(ck)[0]===e):null;
   tag(row,l,s,s?effLabel(e)+(tier?' · '+tierLabel(tier):'')+': '+desc(s):'')}
  if(eff==null&&cur)eff=cur.eff;
  for(const lb of p.querySelectorAll('label')){const sw=lb.querySelector('[aria-label]'),nm=sw?sw.getAttribute('aria-label')||'':'';if(!/fast|быстр/i.test(nm))continue;
   const[l]=rowLabel(lb),s=id?modelSpeed(id,(eff||'')+'|fast'):null,st=id?modelSpeed(id,(eff||'')+'|std'):null;
   tag(lb,l,s,s?'Быстрый режим'+(eff?' · '+effLabel(eff):'')+': '+desc(s)+(st?'\nСтандарт: '+desc(st):''):'')}}
 if(!id&&cur)id=findModel(cur.model);if(eff==null&&cur)eff=cur.eff;
 for(const bs of gs)for(const[b,t]of bs){let tg=null;for(const c of b.children)if(c.classList.contains('oly-seg-speed')){tg=c;break}
  const s=id?modelSpeed(id,(eff||'')+'|'+t):null;if(!s){if(tg)tg.remove();continue}
  if(!tg){tg=document.createElement('span');tg.className='oly-seg-speed';b.appendChild(tg)}
  setText(tg,'· '+sp(s.v,s.method==='exact'));setTitle(tg,tierLabel(t)+(eff?' · '+effLabel(eff):'')+': '+desc(s))}
 for(const m of document.querySelectorAll('[data-model-picker-option-menu]')){const its=[...m.querySelectorAll('[role=menuitemradio]')].map(it=>{const[l,txt]=rowLabel(it);return[it,l,tierFromText(txt)]});
  if(!its.some(x=>x[2]&&x[2]!=='std'))continue;   /* only the speed-mode menu */
  for(const[it,l,t]of its){const s=id&&t?modelSpeed(id,(eff||'')+'|'+t):null;tag(it,l,s,s?tierLabel(t)+(eff?' · '+effLabel(eff):'')+': '+desc(s):'')}}}

/* ---- combos table (usage dialog and card) ---- */
function cmbTable(list){return '<table><thead><tr><th>Уровень</th><th>Режим</th><th class="num">ток/с</th><th class="num">Замеров</th><th class="num">Первый токен</th></tr></thead><tbody>'+
 list.map(x=>'<tr title="'+esc(ckLabel(x.ck)+': '+desc(x.s))+'"><td>'+esc(effLabel(x.e))+'</td><td class="mode">'+esc(tierLabel(x.t))+'</td><td class="num"><b>'+sp(x.s.v,x.s.method==='exact')+'</b></td><td class="num">'+x.s.n+'</td><td class="num">'+fmtS(x.s.ttft)+'</td></tr>').join('')+'</tbody></table>'}

/* ---- usage page card ---- */
function spark(series){const s=series.slice(-30);if(s.length<2)return'';const w=120,h=22,mx=Math.max(...s),mn=Math.min(...s),rg=mx-mn||1;
 const pts=s.map((v,i)=>[(i/(s.length-1))*(w-4)+2,h-3-((v-mn)/rg)*(h-6)]);const d='M'+pts.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join('L');const l=pts[pts.length-1];
 return '<svg class="oly-spark" viewBox="0 0 '+w+' '+h+'" aria-hidden="true"><path d="'+d+'"/><circle cx="'+l[0].toFixed(1)+'" cy="'+l[1].toFixed(1)+'" r="2"/></svg>'}
let cardVer=0,armT=0;
function ensureStats(){if(!/^\/usage/.test(location.pathname))return;let card=document.querySelector('.oly-stats');
 if(!card){const dlg=document.querySelector('[role=dialog][data-slot=dialog-popup]');const vp=dlg&&dlg.querySelector('[data-slot=scroll-area-viewport]');const target=vp&&vp.firstElementChild;if(!target)return;
  card=document.createElement('section');card.className='oly-stats';card.style.cssText='max-width:976px;margin:24px auto 4px;width:calc(100% - 48px);box-sizing:border-box';target.insertBefore(card,target.firstChild);cardVer=0;
  card.addEventListener('click',e=>{const b=e.target.closest('.oly-stats-reset');if(!b)return;
   if(b.dataset.armed==='true'){S=fresh();lastReq.clear();LS(OLD3,null);LS(OLD2,null);touch();save();b.dataset.armed='false';updateStats(true)}
   else{b.dataset.armed='true';b.textContent='Точно сбросить?';clearTimeout(armT);armT=setTimeout(()=>{b.dataset.armed='false';b.textContent='Сбросить'},3500)}})}
 updateStats()}
function updateStats(force){const card=document.querySelector('.oly-stats');if(!card||(!force&&cardVer===ver))return;
 if(card.querySelector('.oly-stats-reset[data-armed=true]')&&!force)return;cardVer=ver;
 const groups={};let allTok=0,allMs=0,allN=0,allExact=true;
 for(const id in S.m){const s=modelSpeed(id);if(!s)continue;const g=prov(S.m[id]);(groups[g]=groups[g]||[]).push([id,s]);allN+=s.n;const w=s.n;allTok+=s.v*w;allMs+=w;if(s.method!=='exact')allExact=false}
 const head='<div class="oly-stats-head"><div><h3>Скорость моделей</h3><p>Токены в секунду при генерации ответа, для всех провайдеров, отдельно по уровню рассуждения и скоростному режиму (Стандарт / Быстро / Сверхбыстро) — так, как ход был отправлен. «Точно» — по счётчикам токенов провайдера за измеренное окно генерации: без ожидания первого токена, инструментов, субагентов и подтверждений. «≈» — оценка по завершённым ходам. Выбросы отброшены, учитываются последние '+NMAX+' замеров каждой комбинации.</p></div><button type="button" class="oly-stats-reset" data-armed="false">Сбросить</button></div>';
 const names=Object.keys(groups).sort((a,b)=>groups[b].reduce((s,x)=>s+x[1].n,0)-groups[a].reduce((s,x)=>s+x[1].n,0));
 if(!names.length){setHTML(card,head+'<div class="empty">Пока нет замеров. Откройте тред, где модель отвечает, — скорость появится после первого запроса.</div>');return}
 let rows='';for(const g of names){const list=groups[g].sort((a,b)=>b[1].n-a[1].n);const gw=list.reduce((s,x)=>s+x[1].n,0),gv=list.reduce((s,x)=>s+x[1].v*x[1].n,0)/gw;
  rows+='<tr class="grp"><td colspan="6"><b>'+esc(g)+'</b> · '+sp(gv,list.every(x=>x[1].method==='exact'))+' ток/с</td></tr>';
  for(const[id,s]of list){const cl=combos(id),one=cl.length===1&&cl[0].ck!=='|';
   rows+='<tr><td class="mdl">'+esc(id)+(one?'<span class="lvl">'+esc(ckLabel(cl[0].ck))+'</span>':'')+'</td><td class="num"><b>'+sp(s.v,s.method==='exact')+'</b> ток/с<div class="rng">'+(s.n>2?fmt(s.lo)+'–'+fmt(s.hi):'&nbsp;')+'</div></td><td class="num">'+fmtS(s.ttft)+'</td><td class="num">'+s.n+(s.drop?'<div class="rng">−'+s.drop+' выбр.</div>':'')+'</td><td><span class="tag" data-m="'+s.method+'">'+meth(s)+'</span></td><td>'+spark(s.series)+'</td></tr>';
   if(cl.length>1)for(const x of cl)rows+='<tr class="cmb"><td class="cl">'+esc(effLabel(x.e))+' <span>· '+esc(tierLabel(x.t))+'</span></td><td class="num"><b>'+sp(x.s.v,x.s.method==='exact')+'</b> ток/с</td><td class="num">'+fmtS(x.s.ttft)+'</td><td class="num">'+x.s.n+'</td><td><span class="tag" data-m="'+x.s.method+'">'+meth(x.s)+'</span></td><td>'+spark(x.s.series)+'</td></tr>'}}
 setHTML(card,head+'<div class="oly-stats-sum"><span class="big">'+sp(allTok/allMs,allExact)+'</span><span class="sub">ток/с в среднем · '+plural(allN,'замер','замера','замеров')+' · '+plural(Object.keys(S.m).length,'модель','модели','моделей')+'</span></div>'+
  '<table><thead><tr><th>Модель · уровень · режим</th><th class="num">Скорость</th><th class="num">Первый токен</th><th class="num">Замеров</th><th>Метод</th><th>Последние замеры</th></tr></thead><tbody>'+rows+'</tbody></table>')}

/* ---- usage model dialog: «Скорость» stat + table by level and mode ---- */
function ensureDialogStat(){for(const dlg of document.querySelectorAll('[role=dialog][data-slot=dialog-popup]')){
 const h=dlg.querySelector('h2[data-slot=dialog-title]'),dl=dlg.querySelector('dl');if(!h||!dl)continue;
 const dts=[...dl.querySelectorAll(':scope>div>dt')].map(x=>x.textContent.trim());if(!dts.some(x=>/^(Стоимость|Cost)$/.test(x))||!dts.some(x=>/кэш|cache/i.test(x)))continue;
 const id=findModel(h.textContent.trim()),s=id&&modelSpeed(id);let cell=dl.querySelector('.oly-dl-speed');
 if(!cell){const proto=dl.querySelector(':scope>div');cell=document.createElement('div');cell.className=(proto&&proto.className||'flex min-w-0 flex-col gap-0.5')+' oly-dl-speed';
  const pdt=proto&&proto.querySelector('dt'),pdd=proto&&proto.querySelector('dd');
  const dt=document.createElement('dt'),dd=document.createElement('dd');dt.className=pdt?pdt.className:'text-xs text-muted-foreground';dt.textContent='Скорость';dd.className=pdd?pdd.className:'text-2xl font-semibold text-foreground';
  cell.appendChild(dt);cell.appendChild(dd);dl.appendChild(cell);dl.classList.add('oly-dl5')}
 setHTML(cell.querySelector('dd'),s?sp(s.v,s.method==='exact')+'<span class="oly-dd-unit">ток/с</span>':'—');
 setTitle(cell,s?(s.method==='exact'?'Точно: по счётчикам токенов провайдера':'Оценка по завершённым ходам')+' · '+plural(s.n,'замер','замера','замеров')+(s.n>2?'\nДиапазон '+fmt(s.lo)+'–'+fmt(s.hi)+' ток/с':'')+(s.ttft>=0?'\nПервый токен '+fmtS(s.ttft):''):'Нет замеров скорости для этой модели');
 const list=id?combos(id):[],nx=dl.nextElementSibling;let box=nx&&nx.classList.contains('oly-cmb')?nx:null;
 if(!showCombos(list)){if(box)box.remove();continue}
 if(!box){box=document.createElement('div');box.className='oly-cmb';dl.after(box)}
 setHTML(box,'<div class="oly-cmb-h">Скорость по уровню рассуждения и режиму</div>'+cmbTable(list))}}

/* ---- model picker list: speed next to each model ---- */
function ensurePicker(){const opts=document.querySelectorAll('[data-slot=combobox-item]');if(!opts.length)return;
 for(const o of opts){const nameEl=o.querySelector('[data-slot=combobox-item-content] .truncate');if(!nameEl)continue;
  const sr=nameEl.querySelector('.sr-only');const name=(nameEl.textContent||'').replace(sr?sr.textContent:'','').trim();
  const id=findModel(name),s=id&&modelSpeed(id);let tg=o.querySelector('.oly-pick-speed');
  if(!s){if(tg)tg.remove();continue}
  if(!tg){tg=document.createElement('span');tg.className='oly-pick-speed';nameEl.parentElement.appendChild(tg)}
  setText(tg,sp(s.v,s.method==='exact')+' ток/с');setTitle(tg,'Средняя скорость '+id+' по всем уровням и режимам ('+meth(s)+')')}}

/* ---- loop ---- */
let pending=false;const tick=()=>{pending=false;try{chip();ensureStats();ensureDialogStat();ensurePicker();ensureEffort()}catch(e){console.warn('oly speed',e)}};
dbg.tick=tick;dbg.stats=()=>updateStats(true);
/* streaming tokens (chat text, code, editor) never wake the tick: the composer chip is refreshed by the 800 ms timer anyway;
   only UI mounts (pickers, dialogs, effort panel) do. Predicate from 05-oly-core, fallback: closest() on the record target. */
const CONTENT_SEL='.chat-markdown,[data-user-message-bubble],pre,code,.composer-tiptap,[contenteditable="true"],textarea,input,select,.xterm';
const inContent=n=>{const c=globalThis.__olyCore;if(c&&typeof c.isContentSubtree==='function')return c.isContentSubtree(n);const e=n&&(n.nodeType===1?n:n.parentElement);try{return!!(e&&e.closest(CONTENT_SEL))}catch(_){return false}};
const start=()=>{new MutationObserver(rs=>{if(pending)return;let ui=false;for(const r of rs)if(!inContent(r.target)){ui=true;break}if(ui){pending=true;requestAnimationFrame(tick)}}).observe(document.body,{childList:true,subtree:true});setInterval(()=>{try{chip();updateStats();ensureDialogStat()}catch(e){}},800);tick()};
document.body?start():addEventListener('DOMContentLoaded',start);
}catch(e){console.warn('oly speed',e)}})();

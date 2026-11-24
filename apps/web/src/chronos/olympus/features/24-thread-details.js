;(()=>{try{
// Thread details panel («Детали треда»): Russian strings the dictionary misses, usage limits that say
// what the number is (remaining %) and when the window resets (from the row's React props), and
// data-oly-td hooks for the compact Olympus layout (feature-css/thread-details.*.css).
// Only text nodes / attributes of React nodes are changed; our own spans are appended next to them.
if(globalThis.__olyThreadDetails)return;
const CARD='[data-thread-details-card]';
const POP='[data-slot="tooltip-popup"],[data-slot="menu-popup"]';
const ANY=CARD+','+POP;
const W={writes:0,passes:0};
const CARD_EXACT={
 'Initialize Git':'Создать репозиторий Git',
 'Initializing...':'Создание репозитория…',
 'Usage limits':'Лимиты',
 'Servers':'Серверы',
 'Automations':'Автоматизации',
 'Parent agent':'Родительский агент',
 'Subagent':'Субагент',
 'Fork':'Ответвление',
 'Parent thread':'Родительский тред',
 'Context transfer':'Передача контекста'
};
const POP_EXACT={
 'Initialize Git':'Создать репозиторий Git',
 'Disconnect agent session':'Отключить сессию агента',
 'Resets in':'Сброс через',
 'Ahead of pace':'Тратится быстрее равномерного',
 'On pace':'Тратится равномерно',
 'Under pace':'Тратится медленнее равномерного',
 'Context compacts automatically when needed.':'Контекст сжимается автоматически, когда нужно.'
};
const LINEAGE=/^(?:Lineage|Происхождение)(?: · (?:(\d+) running|выполняется: (\d+)))?$/;
const LBL={'Weekly':'Неделя','Раз в неделю':'Неделя','Monthly':'Месяц','Раз в месяц':'Месяц','Daily':'День','Session':'Сессия'};
const shortLabel=s=>s.split(' · ').map(p=>LBL[p]||p).join(' · ');
const num=s=>s.replace(/,/g,' ');
function dur(ms){
 const m=Math.max(1,Math.floor(ms/60000));if(m<60)return m+' мин';
 const h=Math.floor(m/60),mm=m%60;if(h<24)return h+' ч'+(h<10&&mm?' '+mm+' мин':'');
 const d=Math.floor(h/24),hh=h%24;return d+' д'+(hh?' '+hh+' ч':'');
}
function setText(n,v){if(n.nodeValue!==v){n.nodeValue=v;W.writes++}}
function attr(e,k,v){if(e.getAttribute(k)!==v){e.setAttribute(k,v);W.writes++}}
function drop(e,k){if(e.hasAttribute(k)){e.removeAttribute(k);W.writes++}}
function txt(e,v){if(e.textContent!==v){e.textContent=v;W.writes++}}
const isText=n=>n&&n.nodeType===3;
const ours=e=>typeof e.className==='string'&&e.className.startsWith('oly-td-');
function own(parent,cls){for(const c of parent.children)if(c.className===cls)return c;return null}
// Hidden until the theme shows it (thread-details.*.css uses !important), so an old theme keeps the native grid.
function add(parent,cls){const e=document.createElement('span');e.className=cls;e.style.display='none';parent.appendChild(e);W.writes++;return e}
function up(e,tag){while(e&&e.tagName!==tag)e=e.parentElement;return e}
// Collect text nodes (and the section headings) under root, skipping our own nodes.
function collect(root,texts,heads){
 const stack=[root];
 while(stack.length){const e=stack.pop();
  for(let c=e.lastChild;c;c=c.previousSibling){
   if(c.nodeType===3)texts.push(c);
   else if(c.nodeType===1&&!ours(c)){
    if(heads&&c.tagName==='H3'&&/^thread-details-.+-heading$/.test(c.id))heads[c.id.slice(15,-8)]=c;
    stack.push(c);
   }
  }
 }
 return texts;
}
function rule(t,pop){
 const x=(pop?POP_EXACT:CARD_EXACT)[t];if(x)return x;let m;
 if(!pop&&(m=LINEAGE.exec(t))){const n=m[1]||m[2];return 'Связанные треды'+(n?' · '+n+' в работе':'')}
 if(!pop)return null;
 if((m=/^Context: (\d+)% used$/.exec(t)))return 'Контекст: занято '+m[1]+'%';
 if((m=/^Context: (.+) tokens used$/.exec(t)))return 'Контекст: '+num(m[1])+' токенов';
 if((m=/^Compacts automatically at about ([\d,]+) tokens\.$/.exec(t)))return 'Автосжатие примерно при '+num(m[1])+' токенов.';
 if(/^\d{1,3}(?:,\d{3})+$/.test(t))return num(t);
 return null;
}
function apply(n,pop){
 const s=n.nodeValue,t=s.trim();if(!t)return;
 const v=rule(t,pop);if(v!==null&&v!==t)setText(n,s.replace(t,v));
}
// «Show 3 more» is three text nodes: "Show ", N, " more".
function showMore(n){
 const a=n.nextSibling,b=a&&a.nextSibling;
 if(n.nodeValue==='Show '&&isText(a)&&/^\d+$/.test(a.nodeValue)&&isText(b)&&b.nodeValue===' more'){setText(n,'Показать ещё ');setText(b,'')}
}
// Tooltip «Weekly: 15% left» is [label, ": ", "15", "% left"] → «Неделя: осталось 15%».
function leftPair(n){
 const p=n.previousSibling,c=p&&p.previousSibling;
 if(isText(p)&&/^\d+$/.test(p.nodeValue)&&isText(c)&&(c.nodeValue===': '||c.nodeValue===': осталось ')){
  setText(c,': осталось ');setText(n,'%');
  const l=c.previousSibling;if(isText(l))setText(l,shortLabel(l.nodeValue));
 }else setText(n,'% осталось');
}
function processPopup(p){
 for(const n of collect(p,[])){
  if(n.nodeValue==='% left'){leftPair(n);continue}
  if(n.nodeValue===': осталось '){const l=n.previousSibling;if(isText(l))setText(l,shortLabel(l.nodeValue));continue}
  apply(n,true);
 }
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
 let m=/^(.+): (\d+)% left$/.exec(cur)||/^(.+): осталось (\d+)%(?:, сброс через .+)?$/.exec(cur);
 if(m)return shortLabel(m[1])+': осталось '+m[2]+'%'+(reset?', сброс через '+reset:'');
 if((m=/^(.+): (\d+)% used$/.exec(cur)))return m[1]+': занято '+m[2]+'%';
 return null;
}
function fullTitle(lab){
 if(lab.scrollWidth>lab.clientWidth+1){attr(lab,'title',lab.textContent);attr(lab,'data-oly-td-title','')}
 else if(lab.hasAttribute('data-oly-td-title')){drop(lab,'title');drop(lab,'data-oly-td-title')}
}
function rows(sec,head){const g=sec.lastElementChild;return g&&g!==head?[...g.children].filter(r=>r.hasAttribute('tabindex')):[]}
function usage(h3,now){
 const sec=up(h3,'SECTION'),head=h3.parentElement;if(!sec||!head)return;
 attr(sec,'data-oly-td','usage');
 if(sec.getAttribute('aria-label')==='Usage limits')attr(sec,'aria-label','Лимиты');
 let any=false;const labs=[];
 for(const row of rows(sec,head)){
  const lab=row.firstElementChild;
  if(lab&&lab.tagName==='SPAN'){labs.push(lab);const t=lab.firstChild;if(isText(t))setText(t,shortLabel(t.nodeValue))}
  const r=resetIn(row,now);if(r)any=true;
  let sp=own(row,'oly-td-reset');if(!sp&&r)sp=add(row,'oly-td-reset');if(sp)txt(sp,r);
  const a=row.getAttribute('aria-label'),v=a&&rowAria(a,r);if(v)attr(row,'aria-label',v);
 }
 const cap=own(head,'oly-td-cap')||add(head,'oly-td-cap');txt(cap,any?'сброс · осталось':'осталось');
 for(const lab of labs)fullTitle(lab);
}
function context(h3){
 const sec=up(h3,'SECTION'),head=h3.parentElement;if(!sec)return;
 attr(sec,'data-oly-td','context');
 for(const row of rows(sec,head)){const a=row.getAttribute('aria-label'),v=a&&rowAria(a,'');if(v)attr(row,'aria-label',v)}
}
// «Связанные треды»: the title may wrap to two lines and a second line says what the thread is to this one
// (subagent / fork / parent), its model and run state. Row data comes from the list's React props, keyed by threadId.
const REL_DOWN={subagent:'Субагент',fork:'Ответвление','side-chat':'Побочный чат',sidechat:'Побочный чат',delegate:'Делегировано',delegated:'Делегировано'};
const REL_UP={subagent:'Родительский агент',fork:'Исходный тред','side-chat':'Основной чат',sidechat:'Основной чат',delegate:'Родительский тред',delegated:'Родительский тред'};
const EDGE_STATE={running:'идёт',starting:'идёт',preparing:'идёт',queued:'в очереди',waiting:'ждёт',completed:'готово',succeeded:'готово',done:'готово',failed:'ошибка',error:'ошибка',interrupted:'остановлен',cancelled:'остановлен',canceled:'остановлен',stopped:'остановлен'};
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
 const up=e.sourceThreadId===r.threadId,kind=String(e.kind||'');
 return[(up?REL_UP:REL_DOWN)[kind]||'',modelOf(r.threadId),EDGE_STATE[String(e.status||'')]||''].filter(Boolean).join(' · ');
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
 attr(h3,'title','Родительский тред, ответвления и субагенты этого треда');
 const stack=[head];
 while(stack.length){const e=stack.pop();for(const c of e.children){
  if(c.tagName==='BUTTON'&&c.getAttribute('aria-haspopup')==='menu')attr(c,'title','Действия с сессией агента');else stack.push(c);
 }}
 try{lineageRows(sec)}catch(_){}
}
function processCard(card,now){
 const heads={};
 for(const n of collect(card,[],heads)){if(n.nodeValue==='Show ')showMore(n);else apply(n,false)}
 if(heads.usage)usage(heads.usage,now);
 if(heads.context)context(heads.context);
 if(heads.lineage)lineage(heads.lineage);
}
let raf=0;
function flush(){
 raf=0;W.passes++;const now=Date.now();
 for(const c of document.querySelectorAll(CARD))processCard(c,now);
 for(const p of document.querySelectorAll(POP))processPopup(p);
}
const schedule=()=>{if(!raf)raf=requestAnimationFrame(flush)};
const near=n=>{const e=n.nodeType===1?n:n.parentElement;return !!(e&&e.closest(ANY))};
const mo=new MutationObserver(ms=>{
 if(raf)return;
 for(const m of ms){
  if(near(m.target)){schedule();return}
  if(m.type==='childList')for(const a of m.addedNodes)if(a.nodeType===1&&(a.matches(ANY)||a.querySelector(ANY))){schedule();return}
 }
});
const CSS=`
[data-thread-details-card] [data-oly-td=lineage] ul>li{height:auto;min-height:2rem}
[data-thread-details-card] [data-oly-td=lineage] ul>li>button{height:auto;min-height:2rem;padding-block:5px;white-space:normal}
[data-thread-details-card] [data-oly-td=lineage] ul>li>button span[class~="truncate"]{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;white-space:normal;text-overflow:clip;overflow-wrap:anywhere;line-height:1.3}
[data-thread-details-card] [data-oly-td=lineage] ul:not(:has([data-workflow-expanded])){max-height:min(20rem,45dvh)}
[data-thread-details-card] .oly-td-sub{display:block;margin-top:2px;overflow:hidden;font-size:11px;font-weight:400;line-height:14px;color:var(--muted-foreground);white-space:nowrap;text-overflow:ellipsis}
[data-thread-details-card] .oly-td-sub:empty{display:none}
`;
const start=()=>{
 try{const st=document.createElement('style');st.id='oly-td-css';st.textContent=CSS;(document.head||document.documentElement).appendChild(st)}catch(_){}
 mo.observe(document.body,{subtree:true,childList:true,characterData:true});schedule();
 // Reset times count down: re-check twice a minute while the limits are on screen (writes only on change).
 setInterval(()=>{if(!document.hidden&&document.querySelector(CARD+' [data-oly-td="usage"]'))schedule()},30000);
};
document.body?start():addEventListener('DOMContentLoaded',start);
globalThis.__olyThreadDetails={flush,processCard,processPopup,shortLabel,dur,rowAria,rowDetail,stats:W};
}catch(e){console.warn('oly thread-details',e)}})();

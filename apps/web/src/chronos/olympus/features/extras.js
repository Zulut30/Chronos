;(()=>{try{
const css=document.createElement("style");(document.head||document.documentElement).append(css);
function ensureComposer(){globalThis.__olyPlanUi?.mount()}
function render(){globalThis.__olyPlanUi?.sync()}
/* ---- Skills manager: sidebar button + in-app dialog (service at 127.0.0.1:4517) ---- */
const SKILLS_URL='http://127.0.0.1:4517/';
const ICON_SKILLS='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>';
css.textContent+=`
.oly-skills-overlay{position:fixed;inset:0;z-index:9000;background:color-mix(in srgb,#000 38%,transparent);display:flex;align-items:center;justify-content:center;padding:32px}
.oly-skills-dialog{width:min(1180px,100%);height:min(820px,100%);background:var(--background);color:var(--foreground);border:1px solid var(--border);border-radius:var(--radius,10px);box-shadow:0 24px 70px #0006;overflow:hidden;display:flex;flex-direction:column}
.oly-skills-dialog iframe{flex:1;border:0;width:100%;background:var(--background)}
.oly-skills-msg{margin:auto;max-width:460px;text-align:center;color:var(--muted-foreground);line-height:1.5;padding:24px}
.oly-skills-msg code{font-family:ui-monospace,Consolas,monospace;color:var(--foreground)}`;
function themeHash(){const cs=getComputedStyle(document.documentElement);const v=n=>encodeURIComponent((cs.getPropertyValue(n)||'').trim());
 const parts=['theme='+(document.documentElement.classList.contains('dark')?'dark':'light'),'olympus='+(/^olympus/.test(document.documentElement.getAttribute('data-theme-id')||'')?'1':'0')];
 for(const[k,n]of[['bg','--background'],['fg','--foreground'],['muted','--muted-foreground'],['border','--border'],['panel','--card'],['accent','--accent'],['primary','--primary'],['primary-fg','--primary-foreground'],['radius','--radius']]){const x=v(n);if(x)parts.push(k+'='+x)}
 return '#'+parts.join('&')}
function closeSkills(){const o=document.querySelector('.oly-skills-overlay');if(o)o.remove()}
async function openSkills(){closeSkills();const o=document.createElement('div');o.className='oly-skills-overlay';o.innerHTML='<div class="oly-skills-dialog" role="dialog" aria-label="Скиллы"><div class="oly-skills-msg">Подключение к менеджеру скиллов…</div></div>';
 o.addEventListener('click',e=>{if(e.target===o)closeSkills()});document.body.appendChild(o);const dlg=o.firstChild;
 let ok=false;try{const c=new AbortController();setTimeout(()=>c.abort(),2500);await fetch(SKILLS_URL+'api/health',{signal:c.signal,mode:'no-cors',cache:'no-store'});ok=true}catch(e){}
 if(!ok){dlg.innerHTML='<div class="oly-skills-msg">Менеджер скиллов не запущен.<br>Он стартует при входе в Windows. Запустить вручную: <code>t3-skills-manager.vbs</code> в папке автозагрузки.</div>';return}
 const f=document.createElement('iframe');f.src=SKILLS_URL+themeHash();f.title='Скиллы';dlg.innerHTML='';dlg.appendChild(f);setTimeout(()=>{try{f.focus()}catch(e){}},50)}
addEventListener('message',e=>{if(e.origin==='http://127.0.0.1:4517'&&e.data&&e.data.type==='oly-skills-close')closeSkills()});
addEventListener('keydown',e=>{if(e.key==='Escape'&&document.querySelector('.oly-skills-overlay'))closeSkills()},true);
function ensureSkillsButton(){if(document.querySelector('[data-oly-skills]'))return;
 const usage=document.querySelector('[data-slot=sidebar] button[aria-label="Usage"],[data-slot=sidebar] button[aria-label="Расход"]');if(!usage)return;
 const item=usage.parentElement&&usage.parentElement.closest('li')||usage.parentElement;if(!item||!item.parentElement)return;
 const clone=item.cloneNode(true);clone.setAttribute('data-oly-skills','');const b=clone.matches('button')?clone:clone.querySelector('button');if(!b)return;
 b.setAttribute('aria-label','Скиллы');b.title='Скиллы';b.removeAttribute('data-state');const svg=b.querySelector('svg');if(svg)svg.outerHTML=ICON_SKILLS;
 b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();openSkills()});item.parentElement.insertBefore(clone,item.nextSibling)}
/* No polling: route changes (pushState included) re-sync the answer-mode pill, mounts re-check the buttons.
   With 05-oly-core: onRoute + onUiMount (chat streaming never wakes this); without it: own observer + URL check. */
let pending=false,href=location.href;
const routed=()=>{if(location.href!==href){href=location.href;render()}};
const tick=()=>{pending=false;ensureComposer();ensureSkillsButton();routed()};
const start=()=>{const core=globalThis.__olyCore;
 if(core&&typeof core.onUiMount==='function'&&typeof core.onRoute==='function'){core.onUiMount(tick);core.onRoute(()=>{href=location.href;render()})}
 else{new MutationObserver(()=>{if(!pending){pending=true;requestAnimationFrame(tick)}}).observe(document.body,{childList:true,subtree:true});
  for(const t of['popstate','hashchange'])addEventListener(t,routed)}
 tick()};
document.body?start():addEventListener('DOMContentLoaded',start);
/* ---- Smooth chat (wave2 «smooth», measured in olympus-v3/wave2-20261118/reports/smooth.md) ----
   1) [data-oly-busy] on the conversation area and the sidebar while the open chat works (thread switch, send, streaming).
      The Olympus theme pauses its decorative infinite animations under this flag: a running animation re-resolves its
      pseudo-element styles every frame (≈60–100 ms of main thread per 2 s of streaming); paused = same cost as none.
      Not on <html>: toggling a root attribute that pseudo-element rules depend on restyles the whole tree (measured 17.9 ms
      vs 1.5 ms scoped), and it is applied in rAF, never inside the input task.
   2) Thread switch: the timeline fades in (html[data-oly-chat-enter], opacity only — LegendList positions the rows itself).
      Started from a MutationObserver callback once rows of the new thread are in the DOM, i.e. before their first paint,
      never during the native render freeze (the old content does not blink).
   3) Send: the new user bubble (data-message-id = messageId of the outgoing message.dispatch) slides in.
   No timers polling; prefers-reduced-motion turns 2) and 3) off. */
(()=>{try{
 const root=document.documentElement,RM=matchMedia('(prefers-reduced-motion: reduce)');
 css.textContent+=`
@keyframes oly-chat-in{from{opacity:0}to{opacity:1}}
@keyframes oly-msg-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
:root[data-oly-chat-enter] .messages-timeline-scroll{animation:oly-chat-in .22s ease-out both}
@media (prefers-reduced-motion:reduce){:root[data-oly-chat-enter] .messages-timeline-scroll{animation:none}}`;
 const bubbleCss=document.createElement('style');bubbleCss.setAttribute('data-oly-smooth','');
 /* busy: one timer, extended by bumping the deadline (streaming calls this per mutation batch); the attribute follows in rAF */
 const HOSTS='[data-workspace-area^=conv],[data-slot=sidebar-inner]';
 let until=0,busyTimer=0,isBusy=false,applyRaf=0;
 const apply=()=>{applyRaf=0;for(const e of document.querySelectorAll(HOSTS))if(e.hasAttribute('data-oly-busy')!==isBusy)isBusy?e.setAttribute('data-oly-busy',''):e.removeAttribute('data-oly-busy')};
 const setBusy=v=>{if(isBusy===v)return;isBusy=v;if(!applyRaf)applyRaf=requestAnimationFrame(apply)};
 const check=()=>{busyTimer=0;const left=until-performance.now();if(left>20){busyTimer=setTimeout(check,left);return}setBusy(false)};
 const busy=ms=>{const t=performance.now()+ms;if(t>until)until=t;setBusy(true);if(!busyTimer)busyTimer=setTimeout(check,ms)};
 /* 1) streaming / any change inside the conversation area keeps the flag for 1.2 s; the once-a-second elapsed-time counter
    of a running turn (.tabular-nums) alone does not — otherwise the scene would stay frozen while an agent runs tools */
 const tick=n=>{const e=n&&(n.nodeType===1?n:n.parentElement);return!!(e&&e.closest('.tabular-nums'))};
 let watched=null;const convMo=new MutationObserver(rs=>{for(const r of rs)if(!tick(r.target)){busy(1200);return}});
 const watch=()=>{const a=document.querySelector('[data-workspace-area^=conv]');if(a===watched)return;convMo.disconnect();watched=a;if(a)convMo.observe(a,{childList:true,subtree:true,characterData:true});if(isBusy&&!applyRaf)applyRaf=requestAnimationFrame(apply)};
 /* 2) thread switch */
 let lastThread,enterMo=null,enterStop=0,enterOff=0;
 const msgIds=()=>{const s=new Set();for(const e of document.querySelectorAll('[data-message-id]'))s.add(e.getAttribute('data-message-id'));return s};
 const enter=()=>{if(enterMo){enterMo.disconnect();enterMo=null}clearTimeout(enterStop);root.setAttribute('data-oly-chat-enter','');
  clearTimeout(enterOff);enterOff=setTimeout(()=>root.removeAttribute('data-oly-chat-enter'),420)};
 const onThread=id=>{if(id===lastThread)return;const first=lastThread===undefined;lastThread=id;busy(1600);watch();
  if(first||!id||RM.matches)return;
  if(enterMo)enterMo.disconnect();const old=msgIds();
  enterMo=new MutationObserver(()=>{for(const e of document.querySelectorAll('[data-message-id]'))if(!old.has(e.getAttribute('data-message-id'))){enter();return}});
  enterMo.observe(document.querySelector('main')||document.body,{childList:true,subtree:true});
  clearTimeout(enterStop);enterStop=setTimeout(()=>{if(enterMo){enterMo.disconnect();enterMo=null}},2500)};
 /* 3) send */
 let bubbleOff=0;
 const onSend=m=>{const p=m&&m.payload;if(!p||p.type!=='message.dispatch')return;busy(3000);if(RM.matches||!p.messageId)return;
  if(!bubbleCss.isConnected)(document.head||root).append(bubbleCss);
  bubbleCss.textContent='[data-message-id="'+CSS.escape(String(p.messageId))+'"] [data-user-message-bubble]{animation:oly-msg-in .24s cubic-bezier(.2,.7,.2,1) both}';
  clearTimeout(bubbleOff);bubbleOff=setTimeout(()=>{bubbleCss.textContent=''},800)};
 const startSmooth=()=>{const core=globalThis.__olyCore;
  const tid=()=>{const r=core&&typeof core.route==='function'?core.route():null;if(r&&'threadId' in r)return r.threadId||null;const m=location.pathname.match(/^\/[^/]+\/([0-9a-f-]{36})(?:\/|$)/i);return m?m[1]:null};
  onThread(tid());watch();
  if(core&&typeof core.onRoute==='function')core.onRoute(r=>onThread(r&&r.threadId||null));
  else for(const t of['popstate','hashchange'])addEventListener(t,()=>onThread(tid()));
  if(core&&typeof core.onUiMount==='function')core.onUiMount(watch);
  if(core&&typeof core.onWsSend==='function')core.onWsSend(onSend,{contains:['message.dispatch']})};
 globalThis.__olySmooth={busy,enter,onThread,onSend,get state(){return{busy:isBusy,thread:lastThread,watching:!!watched}}};
 document.body?startSmooth():addEventListener('DOMContentLoaded',startSmooth);
}catch(e){console.warn('oly smooth',e)}})();
}catch(e){console.warn('olympus extras',e)}})();

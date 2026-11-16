;(()=>{try{
/* Olympus extras: Plan-mode toggle, Skills button. Model speed (tok/s chip, usage stats) lives in features/20-speed.js. */
const LS=(k,v)=>{try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){return null}};
globalThis.__olyPlan=LS('oly-plan')==='1';
const css=document.createElement('style');
css.textContent=`
.oly-chip{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 8px;border:0;border-radius:var(--control-radius,6px);background:transparent;color:var(--muted-foreground);font:inherit;font-size:13px;line-height:1;white-space:nowrap;flex-shrink:0;cursor:pointer;transition:background-color .15s,color .15s}
.oly-chip:hover{background:var(--accent);color:var(--foreground)}
.oly-chip svg{width:14px;height:14px;flex-shrink:0;opacity:.85}
.oly-plan[aria-pressed=true]{color:#6D3FD1;background:color-mix(in srgb,#7C4DDB 12%,transparent)}
.dark .oly-plan[aria-pressed=true]{color:#C4B0FF;background:color-mix(in srgb,#9C7BFF 18%,transparent)}
html.oly-plan-on [data-slot=composer-host]{border-color:color-mix(in srgb,#7C4DDB 70%,transparent)!important}`;
(document.head||document.documentElement).appendChild(css);
const syncPlanClass=()=>document.documentElement.classList.toggle('oly-plan-on',globalThis.__olyPlan===true);

/* ---- UI in the composer ---- */
const ICON_PLAN='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="m9 14 2 2 4-4"/></svg>';
function ensureComposer(){const host=document.querySelector('[data-slot=composer-host]');if(!host)return;
 const anchor=host.querySelector('button[data-composer-shortcut~="composer.effort"]');if(!anchor||!anchor.parentElement)return;
 let plan=host.querySelector('.oly-plan');
 if(!plan){plan=document.createElement('button');plan.type='button';plan.className='oly-chip oly-plan';plan.innerHTML=ICON_PLAN+'<span>План</span>';
  plan.title='Режим планирования: модель изучит задачу и предложит план, ничего не меняя. Выключите, чтобы выполнить план.';
  plan.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();globalThis.__olyPlan=!globalThis.__olyPlan;LS('oly-plan',globalThis.__olyPlan?'1':'0');render()});
  anchor.parentElement.insertBefore(plan,anchor)}
 render()}
function render(){syncPlanClass();const host=document.querySelector('[data-slot=composer-host]');if(!host)return;
 const plan=host.querySelector('.oly-plan');if(plan)plan.setAttribute('aria-pressed',String(globalThis.__olyPlan===true));
}

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
let pending=false;const tick=()=>{pending=false;ensureComposer();ensureSkillsButton()};
const start=()=>{new MutationObserver(()=>{if(!pending){pending=true;requestAnimationFrame(tick)}}).observe(document.body,{childList:true,subtree:true});setInterval(render,700);tick()};
document.body?start():addEventListener('DOMContentLoaded',start);
}catch(e){console.warn('olympus extras',e)}})();

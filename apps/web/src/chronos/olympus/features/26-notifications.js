;(()=>{try{
'use strict';
if(globalThis.__olyNotifications)return;
function init(){
 const bus=globalThis.__olyBudgetEvents;if(!bus||globalThis.__olyNotifications)return;
 const {node,route}=bus;
 const modes={all:'Все фоновые',minimized:'Только свёрнутое окно',silent:'Без звука',off:'Выкл'};
 const pref='oly-notifications-mode',activeKey='oly-notifications-active',postedKey='oly-notifications-posted';
 const read=k=>{try{return localStorage.getItem(k)}catch{return null}};
 const write=(k,v)=>{try{if(v==null)localStorage.removeItem(k);else localStorage.setItem(k,v)}catch{}};
 let mode=read(pref)||'all';if(!Object.hasOwn(modes,mode))mode='all';
 const owner=globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2),born=Date.now(),titles=new Map(),starts=new Map(),seen=new Set(),attention=new Map(),banners=new Map();
 const focused=()=>!document.hidden && document.hasFocus();
 const keyOf=(env,thread)=>(env||'')+'/'+thread;
 let channel;try{channel=new BroadcastChannel('oly-notifications-views')}catch{}
 function currentKey(){const {env,thread}=route();return thread?keyOf(env,thread):null}
 function viewed(key){
   if(attention.delete(key))render();
   banners.get(key)?.close();banners.delete(key);
 }
 let announced;
 function presence(){
   const key=currentKey(),active=focused(),last=otherView();
   if(active){if(last?.[0]!==owner||last[1]!==key||Date.now()-last[2]>=15000)write(activeKey,JSON.stringify([owner,key,Date.now()]))}
   else if(read(activeKey)?.startsWith('["'+owner+'"'))write(activeKey,null);
   if(active&&key){viewed(key);if(announced!==key)channel?.postMessage(key)}
   announced=active?key:null;
 }
 if(channel)channel.onmessage=e=>{if(typeof e.data==='string')viewed(e.data)};
 function otherView(){try{const v=JSON.parse(read(activeKey));return v&&Date.now()-v[2]<45000?v:null}catch{return null}}
 setInterval(()=>{if(focused())presence()},20000);
 const statuses={completed:'Ход завершён',failed:'Ошибка хода',approval:'Нужно подтверждение',question:'Вопрос к вам',secret:'Нужно ввести секрет'};
 const requestKinds=new Set(['command','file-read','file-change','permission','mcp-elicitation','approval']);
 function reqKind(r){if(r.userOnly&&r.kind==='user_input')return 'question';if(['request_secret','secret_request'].includes(r.kind))return 'secret';
   if(['user_question','user_input'].includes(r.kind))return 'question';if(requestKinds.has(r.kind))return 'approval'}
 let audio;
 function unlock(){
   try{audio||=new AudioContext();if(audio.state==='suspended')void audio.resume().catch(()=>{})}catch{}
 }
 function chime(){
   if(!audio||audio.state!=='running')return;
   const t=audio.currentTime;
   for(const [freq,delay] of [[523.25,0],[659.25,.07]]){
     const osc=audio.createOscillator(),gain=audio.createGain(),start=t+delay;
     osc.frequency.value=freq;gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(.038,start+.018);gain.gain.exponentialRampToValueAtTime(.0001,start+.22);
     osc.connect(gain);gain.connect(audio.destination);osc.onended=()=>{osc.disconnect();gain.disconnect()};osc.start(start);osc.stop(start+.23);
   }
 }
 document.addEventListener('pointerdown',()=>{if(mode==='all'||mode==='minimized')unlock()},{once:true,capture:true});
 function linkFor(thread){const suffix='/'+encodeURIComponent(thread);return [...document.querySelectorAll('a[href]')].find(el=>el.getAttribute('href').split(/[?]/)[0].endsWith(suffix))}
 function go(entry){
   window.focus();
   const env=entry.env||route().env,router=globalThis.__TSR_ROUTER__;
   if(env&&router)void router.navigate({to:'/$environmentId/$threadId',params:{environmentId:env,threadId:entry.thread}}).then(presence);
   else {const a=linkFor(entry.thread);if(a)a.click();else if(env){const p='/'+encodeURIComponent(env)+'/'+encodeURIComponent(entry.thread);if(location.hash.startsWith('#/'))location.hash=p;else location.assign(p)}}
   closeMenu();
 }
 const permission=()=>globalThis.Notification?.permission || 'unavailable';
 async function askPermission(){if(permission()==='default'){try{await Notification.requestPermission()}catch{}render()}}
 function ignoreForeground(key){
   const other=otherView();
   return (focused()&&currentKey()===key) || (other?.[0]!==owner&&other?.[1]===key) || (mode==='minimized'&&(focused()||other?.[0]&&other[0]!==owner));
 }
 async function native(entry,tag){
   function post(){
     if(mode==='off'||!attention.has(entry.key)||ignoreForeground(entry.key))return;
     let posted=[];try{posted=JSON.parse(read(postedKey))||[]}catch{}
     if(posted.includes(tag))return;
     write(postedKey,JSON.stringify([...posted.slice(-150),tag]));
     if(mode!=='silent')chime();
     if(permission()!=='granted')return;
     try{
       banners.get(entry.key)?.close();
       const banner=new Notification(entry.title,{body:statuses[entry.status],tag:'oly-'+entry.key,silent:true});
       banners.set(entry.key,banner);banner.onclick=()=>{go(entry);banner.close()};
       banner.onclose=()=>{if(banners.get(entry.key)===banner)banners.delete(entry.key)};
     }catch{}
   }
   if(navigator.locks){try{await navigator.locks.request('oly-notifications-delivery',post);return}catch{}}
   post();
 }
 function notice(e,id,status,at,start){
   if(!id||!status)return;
   const env=e.env||route().env, key=keyOf(env,e.thread);
   const kind=['completed','failed'].includes(status)?'run':'request';
   const tag=key+'/'+kind+'/'+id;
   if(seen.has(tag))return;
   seen.add(tag);if(seen.size>4096)seen.delete(seen.values().next().value);
   if(e.snapshot || mode==='off'||(Number.isFinite(at)&&at<born-1500)||ignoreForeground(key))return;
   if(kind==='run'&&!focused()&&!(at-start>=5000))return;
   const entry={key,env,thread:e.thread,title:titles.get(key)||linkFor(e.thread)?.textContent.trim()||'Тред '+e.thread.slice(0,8),status,id};
   attention.set(key,entry);render();void native(entry,tag);
 }
 function run(e,id,status,start,end){
   if(!id)return;const key=keyOf(e.env||route().env,e.thread)+'/'+id;
   if(start&&!starts.has(key))starts.set(key,Date.parse(start));
   if(!['completed','failed','interrupted','cancelled','rolled_back'].includes(status))return;
   const began=starts.get(key);starts.delete(key);
   if(status==='completed'||status==='failed')notice(e,id,status,Date.parse(end),began);
 }
 function req(e,r,id,pending){
   if(!id)return;
   if(pending){notice(e,id,reqKind(r),Date.parse(r.createdAt));return}
   const key=keyOf(e.env||route().env,e.thread);
   if(attention.get(key)?.id===id)viewed(key);
 }
 function frame(e){
   const {kind,record:r,id}=e;
   if((kind==='shell'||kind==='thread.metadata-updated')&&r.title)titles.set(keyOf(e.env||route().env,e.thread),r.title);
   if(kind==='shell'){
     run(e,id(r.latestRunId),r.status,r.latestRunStartedAt,r.latestRunCompletedAt);
     if(r.pendingRuntimeRequest){const q=r.pendingRuntimeRequest;req(e,q,id(q.id),true)}
     else {const key=keyOf(e.env||route().env,e.thread),a=attention.get(key);if(a&&['approval','question','secret'].includes(a.status))viewed(key)}
   } else if(kind==='run.created'||kind==='run.updated')run(e,id(r.id),r.status,r.startedAt,r.completedAt);
   else if(kind==='provider-turn.updated'&&r.runAttemptId==null)run(e,id(r.id),r.status,r.startedAt,r.completedAt);
   else if(kind==='runtime-request.updated')req(e,r,id(r.id),r.status==='pending');
   else if(kind==='turn-item.updated'){
     if(r.type==='secret_request')req(e,{kind:r.type,createdAt:r.startedAt},id(r.id),r.secretStatus==='pending');
     if(r.type==='approval_request'||r.type==='user_input_request')req(e,{kind:r.requestKind||'user_input',createdAt:r.startedAt},id(r.requestId),r.completedAt==null&&!r.questionAnswer);
   }
 }
 const style=node('style');style.textContent=`
.oly-notify-wrap{position:relative;display:flex;align-items:center;gap:6px;justify-content:flex-end;min-width:0;padding:3px 4px;color:var(--foreground);font:13px/1.35 Inter,system-ui,sans-serif}
.oly-notify-wrap button,.oly-notify-bell:not([data-place=row]),.oly-notify-menu button{font:inherit;color:inherit;cursor:pointer;border:1px solid var(--border);background:var(--background);border-radius:var(--control-radius,4px);min-height:28px;padding:3px 7px}.oly-notify-wrap button:hover,.oly-notify-bell:not([data-place=row]):hover{background:var(--accent)}.oly-notify-sep{border:0;border-top:1px solid var(--border);margin:5px 2px}.oly-notify-wrap button:focus-visible,.oly-notify-bell:focus-visible,.oly-notify-menu button:focus-visible{outline:2px solid var(--primary);outline-offset:2px}.oly-notify-bell{position:relative;display:grid;place-items:center;flex:none}.oly-notify-bell svg{width:16px;height:16px}.oly-notify-bell[data-mode=off]{opacity:.68}
.oly-notify-bell[data-place=header]{width:28px;height:28px;min-height:28px;padding:0;border:0;background:transparent;color:var(--sidebar-icon-color,var(--muted-foreground));border-radius:var(--radius-md,6px)}.oly-notify-bell[data-place=header]:hover{background:var(--sidebar-row-hover,var(--accent));color:var(--sidebar-foreground,var(--foreground))}
.oly-notify-bell[data-waiting]::after{content:"";position:absolute;top:4px;right:4px;width:6px;height:6px;border-radius:50%;background:var(--primary);box-shadow:0 0 0 2px var(--sidebar,var(--background))}
.oly-notify-wrap[data-place=header]{justify-content:flex-start;padding:4px 0 0}.oly-notify-wrap[data-place=header] .oly-notify-badge{min-height:24px;padding:1px 8px;font-size:12px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.oly-notify-wrap[data-place=topbar]{padding:0 0 0 4px}.oly-notify-wrap[data-place=topbar] .oly-notify-badge{max-width:min(40vw,190px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.oly-notify-wrap[data-place=floating]{position:fixed;left:8px;bottom:8px;z-index:40;background:var(--card,var(--background));border:1px solid var(--border);border-radius:var(--control-radius,4px);box-shadow:0 6px 20px #0002}
.oly-notify-badge{margin-right:auto}.oly-notify-wrap [hidden],.oly-notify-wrap[hidden],.oly-notify-bell[hidden]{display:none!important}.oly-notify-menu{position:fixed;inset:auto;z-index:10001;box-sizing:border-box;width:min(264px,calc(100vw - 16px));max-height:min(380px,calc(100vh - 20px));overflow:auto;background:var(--card);color:var(--foreground);border:1px solid var(--border);border-radius:var(--control-radius,4px);box-shadow:0 8px 28px #0003;padding:7px;font:13px/1.35 Inter,system-ui,sans-serif}.oly-notify-menu button{display:block;width:100%;min-height:28px;background:transparent;border:0;text-align:left;padding:6px 8px;overflow-wrap:anywhere}.oly-notify-menu button:hover{background:var(--accent)}.oly-notify-menu button[aria-pressed=true]{background:var(--accent);color:var(--primary)}.oly-notify-status,.oly-notify-permission{display:block;color:var(--muted-foreground);font-size:12px}.oly-notify-permission{padding:5px 8px}`;
 (document.head||document.documentElement).append(style);
 const wrap=node('div','oly-notify-wrap'),badge=node('button','oly-notify-badge'),bell=node('button','oly-notify-bell');
 const icon='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 9h18c0-1-3-2-3-9M10 20a2.3 2.3 0 0 0 4 0"/></svg>';
 /* Место колокольчика (place): header — в строке иконок шапки боковой панели (рядом с «Новый тред», «День / ночь»),
    бейдж — полоской под этой строкой; topbar — рядом с кнопкой показа боковой панели (панель свёрнута / узкое окно);
    footer — прежнее место внизу боковой панели; floating — угол окна, если нет ничего из перечисленного. */
 let place=null;
 bell.innerHTML=icon;wrap.append(badge,bell);let menu,tab;
 const inUi=t=>wrap.contains(t)||bell.contains(t)||!!menu?.contains(t);
 function closeMenu(restore=false){if(!menu)return;const anchor=tab==='modes'?bell:badge;menu.remove();menu=null;tab=null;anchor.setAttribute('aria-expanded','false');if(restore)(anchor.hidden||!anchor.isConnected?bell:anchor).focus()}
 function choose(value){
   mode=value;write(pref,value);
   if(value==='off'){attention.clear();for(const b of banners.values())b.close()}
   else {if(value!=='silent')unlock();void askPermission()}
   closeMenu(true);render();
 }
 /* Меню открывается вниз от кнопки (правым краем к её правому краю); не помещается снизу — вверх; всегда в пределах окна. */
 function position(){
   if(!menu)return;const r=(tab==='modes'?bell:badge).getBoundingClientRect(),w=menu.offsetWidth,h=menu.offsetHeight;
   menu.style.left=Math.max(8,Math.min(r.right-w,innerWidth-w-8))+'px';
   const below=r.bottom+5,above=r.top-h-5;
   menu.style.top=Math.max(8,Math.min(innerHeight-h-8,below+h<=innerHeight-8||above<8?below:above))+'px';
 }
 function render(){
   badge.hidden=!attention.size||mode==='off';badge.textContent='Ждут внимания ('+attention.size+')';
   if(wrap.dataset.place==='header'){if(wrap.hidden!==badge.hidden)wrap.hidden=badge.hidden}else if(wrap.hidden)wrap.hidden=false;
   bell.toggleAttribute('data-waiting',!badge.hidden);
   bell.dataset.mode=mode;bell.title='Уведомления · '+modes[mode]+(badge.hidden?'':' · ждут внимания: '+attention.size);bell.setAttribute('aria-label',bell.title);
   if(!menu)return;if(tab==='threads'&&badge.hidden){closeMenu();return}
   menu.replaceChildren();
   const threadButtons=()=>{for(const entry of [...attention.values()].reverse()){
     const b=node('button','',entry.title);b.append(node('span','oly-notify-status',statuses[entry.status]));b.onclick=()=>go(entry);menu.append(b)
   }};
   if(tab==='modes'){
     /* В ряду иконок подвала отдельной полоски «Ждут внимания» нет — список треда идёт первым в меню колокольчика. */
     if(place==='row'&&!badge.hidden){menu.append(node('small','oly-notify-permission','Ждут внимания'));threadButtons();menu.append(node('hr','oly-notify-sep'))}
     for(const [value,label] of Object.entries(modes)){
       const b=node('button','',label);b.setAttribute('aria-pressed',String(mode===value));b.onclick=()=>choose(value);menu.append(b)
     }
     if(permission()==='default'){const b=node('button','','Разрешить системные уведомления');b.onclick=askPermission;menu.append(b)}
     if(['unavailable','denied'].includes(permission()))menu.append(node('small','oly-notify-permission','Системные баннеры недоступны'));
   } else threadButtons();
   position();
 }
 function toggle(which){
   const prev=tab;closeMenu();if(prev===which)return;
   tab=which;menu=node('div','oly-notify-menu');menu.dataset.olyNotifyMenu=which;menu.setAttribute('role','group');menu.setAttribute('aria-label',tab==='modes'?'Режим уведомлений':'Ждут внимания');
   document.body.append(menu);(tab==='modes'?bell:badge).setAttribute('aria-expanded','true');render();menu.querySelector('button')?.focus();
 }
 for(const b of [badge,bell]){b.type='button';b.setAttribute('aria-expanded','false')}
 bell.onclick=()=>toggle('modes');badge.onclick=()=>toggle('threads');
 document.addEventListener('pointerdown',e=>{if(menu&&!inUi(e.target))closeMenu()},true);
 document.addEventListener('keydown',e=>{if(menu&&e.key==='Escape'){closeMenu(true);e.preventDefault()}});
 addEventListener('resize',position);document.addEventListener('scroll',position,true);
 function visible(el){if(!el?.isConnected)return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight}
 /* Строка шапки боковой панели (bundle: gB): div.flex.items-center.gap-1 > [div с input[type=search][role=combobox] «Поиск тредов»,
    div.flex.shrink-0.items-center с кнопками «Добавить проект» / «Новый тред» / «День / ночь»]. */
 function headerRow(){
   for(const input of document.querySelectorAll('input[type=search][role=combobox]')){
     if(input.closest('nav[data-workspace-area=settings-nav],[data-slot=composer-host],.oly-notify-menu'))continue;
     const pill=input.parentElement,row=pill?.parentElement,group=row?.lastElementChild;
     if(!group||group===pill||!group.querySelector('button'))continue;
     if(visible(group))return {row,group};
   }
   return null;
 }
 /* Ряд иконок подвала боковой панели (Настройки, Пул-реквесты, Расход, Скиллы, Студия): ul[data-sidebar=menu] в sidebar-footer.
    Колокольчик встаёт туда последним пунктом с классами соседней нативной кнопки — без отдельной строки (пользователь, 2026-11-18). */
 let item=null;
 function footerRow(){
   const ul=document.querySelector('[data-slot=sidebar-footer]:not(nav[data-workspace-area=settings-nav] *)>ul[data-sidebar=menu]');
   return ul&&visible(ul)?ul:null;
 }
 function plainBell(){if(bell.className!=='oly-notify-bell')bell.className='oly-notify-bell';delete bell.dataset.sidebar;delete bell.dataset.size;if(item?.isConnected)item.remove()}
 function setPlace(value){if(place===value)return;place=value;closeMenu();wrap.dataset.place=value;bell.dataset.place=value==='header'||value==='row'?value:'wrap';render()}
 function mount(){
   const row=footerRow(),head=row?null:headerRow();
   if(row){
     const proto=[...row.children].find(li=>li!==item&&li.matches('li[data-slot=sidebar-menu-item]'));
     if(!item){item=document.createElement('li');item.dataset.slot='sidebar-menu-item';item.dataset.sidebar='menu-item'}
     const liClass=(proto?.className||'relative shrink-0')+' oly-notify-item',bClass='oly-notify-bell '+(proto?.querySelector('button')?.className||'');
     if(item.className!==liClass)item.className=liClass;
     if(bell.className!==bClass)bell.className=bClass;
     if(bell.dataset.size!=='icon'){bell.dataset.sidebar='menu-button';bell.dataset.size='icon'}
     if(bell.parentElement!==item)item.append(bell);
     if(item.parentElement!==row||row.lastElementChild!==item)row.append(item);
     if(wrap.isConnected)wrap.remove();
     setPlace('row');
   } else if(head){
     plainBell();
     if(bell.parentElement!==head.group)head.group.append(bell);
     if(wrap.previousElementSibling!==head.row||wrap.parentElement!==head.row.parentElement)head.row.after(wrap);
     setPlace('header');
   } else {
     plainBell();
     if(bell.parentElement!==wrap)wrap.append(bell);
     const trigger=[...document.querySelectorAll('[data-slot=sidebar-trigger]')].find(visible);
     const footer=document.querySelector('[data-slot=sidebar-footer]:not(nav[data-workspace-area=settings-nav] *)')||document.querySelector('[data-slot=sidebar-content]')?.parentElement;
     if(trigger){if(trigger.nextElementSibling!==wrap)trigger.after(wrap);setPlace('topbar')}
     else if(footer){if(wrap.parentElement!==footer)footer.append(wrap);setPlace('footer')}
     else if(document.querySelector('[data-slot=sidebar-wrapper],[data-slot=sidebar-inset]')){if(wrap.parentElement!==document.body)document.body.append(wrap);setPlace('floating')}
   }
   presence();
 }
 /* Сворачивание/разворачивание боковой панели меняет только атрибуты и transform — перепроверяем место после анимации. */
 let again=0;const remount=()=>{if(again)return;again=requestAnimationFrame(()=>{again=0;mount();setTimeout(()=>requestAnimationFrame(mount),320)})};
 try{new MutationObserver(rs=>{if(rs.some(r=>r.target.matches?.('[data-slot^=sidebar],.peer,[data-sidebar]')))remount()}).observe(document.documentElement,{attributes:true,subtree:true,attributeFilter:['data-state','data-collapsible','data-mobile']})}catch{}
 addEventListener('resize',remount);document.addEventListener('transitionend',e=>{if(e.target?.matches?.('[data-slot=sidebar-container],[data-slot=sidebar-gap]'))remount()},true);
 addEventListener('focus',presence);addEventListener('blur',presence);document.addEventListener('visibilitychange',presence);
 addEventListener('pagehide',()=>{if(otherView()?.[0]===owner)write(activeKey,null)});
 addEventListener('storage',e=>{if(e.key===pref&&Object.hasOwn(modes,e.newValue)){mode=e.newValue;if(mode==='off'){attention.clear();for(const b of banners.values())b.close()}render()}});
 bus.subscribe(frame);globalThis.__olyNotifications={get mode(){return mode},get waiting(){return attention.size}};
 render();bus.onMount(mount);
}
if(globalThis.__olyBudgetEvents)init();else addEventListener('oly-budget-wire-ready',init,{once:true});
}catch(e){console.warn('oly notifications',e)}})();

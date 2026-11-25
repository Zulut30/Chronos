(()=>{'use strict';
const $=id=>document.getElementById(id),root=document.documentElement;
const S={machines:[],locations:[],data:null,loading:false,pending:null,seq:0,agent:'codex',filter:'all',error:null,removing:null};
const store={get(k){try{return localStorage.getItem('oly-mcp-'+k)}catch{return null}},set(k,v){try{localStorage.setItem('oly-mcp-'+k,v)}catch{}}};
if(store.get('agent')==='claude')S.agent='claude';

/* ---------- Тема: параметры из адреса (#theme=…&olympus=…) и обновления от T3 через postMessage ---------- */
const TOKENS=['bg','fg','muted','border','panel','accent','primary-fg','hover','radius'],darkQuery=matchMedia('(prefers-color-scheme: dark)');
let theme=new URLSearchParams(location.hash.slice(1));
function applyTheme(){
 const t=theme.get('theme'),dark=t?t==='dark':darkQuery.matches;
 root.classList.toggle('dark',dark);root.style.colorScheme=dark?'dark':'light';
 root.classList.toggle('oly',theme.get('olympus')==='1');
 root.classList.toggle('embedded',!!theme.get('embedded'));
 for(const k of TOKENS){const v=theme.get(k);if(v&&v.length<160&&!/url\(|[;{}]/i.test(v))root.style.setProperty('--t3-'+k,v);else root.style.removeProperty('--t3-'+k)}
}
applyTheme();
darkQuery.addEventListener('change',()=>{if(!theme.get('theme'))applyTheme()});
addEventListener('hashchange',()=>{theme=new URLSearchParams(location.hash.slice(1));applyTheme()});
addEventListener('message',e=>{if(parent===window||e.source!==parent)return;const d=e.data;if(d&&d.type==='oly-mcp-theme'&&typeof d.hash==='string'&&d.hash.length<4000){theme=new URLSearchParams(d.hash.replace(/^#/,''));applyTheme()}});

/* ---------- Утилиты ---------- */
const ICONS={trash:'<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>',lock:'<rect x="4" y="11" width="16" height="10" rx="1"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',term:'<path d="m4 17 6-5-6-5"/><path d="M12 19h8"/>',globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',x:'<path d="M18 6 6 18M6 6l12 12"/>',plus:'<path d="M12 5v14M5 12h14"/>',retry:'<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'};
function icon(name){const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('viewBox','0 0 24 24');s.setAttribute('aria-hidden','true');s.innerHTML=ICONS[name];return s}
function node(tag,text,cls,attrs){const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;if(attrs)for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);return e}
function button(text,cls,onclick,attrs){const b=node('button',null,cls,{type:'button',...attrs});if(Array.isArray(text))b.append(...text);else if(text!=null)b.textContent=text;b.onclick=onclick;return b}
const CONFLICT=/изменил|изменена другим процессом|Обновите список/i;

async function api(route,data){
 let r;
 try{r=await fetch('/api/'+route,{method:data?'POST':'GET',headers:data?{'content-type':'application/json','x-oly':'1'}:{},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(35000),cache:'no-store'})}
 catch(e){throw Error(e&&e.name==='TimeoutError'?'Устройство не ответило вовремя. Проверьте подключение и попробуйте ещё раз.':'Служба менеджера MCP не отвечает. Возможно, она остановлена — запустите её из автозагрузки.')}
 let j;try{j=await r.json()}catch{throw Error('Служба вернула непонятный ответ. Обновите список.')}
 if(!r.ok||(j&&j.error))throw Error((j&&j.error)||'Не удалось выполнить действие');
 return j;
}

/* ---------- Сообщения ---------- */
let noticeTimer=0;
function notice(text,kind='info',action){
 const n=$('notice');clearTimeout(noticeTimer);
 if(!text){n.hidden=true;return}
 n.dataset.kind=kind;n.setAttribute('aria-live',kind==='error'?'assertive':'polite');$('notice-text').textContent=text;
 const a=$('notice-action');a.hidden=!action;if(action){a.textContent=action.label;a.onclick=()=>{notice('');action.run()}}
 n.hidden=false;
 if(kind==='ok')noticeTimer=setTimeout(()=>notice(''),7000);
}
$('notice-close').onclick=()=>notice('');

/* ---------- Устройства и расположения ---------- */
const machineLabel=()=>S.machines.find(m=>m.id===$('machine').value)?.label||'';
const projectName=l=>(l.project||'').split(/[\\/]/).filter(Boolean).pop()||l.label;
function locLabel(l){if(!l)return'';if(l.scope==='user')return'Общие — для всех проектов';if(l.scope==='local')return'Проект «'+projectName(l)+'» — только для вас';return'Проект «'+projectName(l)+'»'}
function fillMachines(){const el=$('machine');el.replaceChildren(...S.machines.map(m=>{const o=node('option',m.label);o.value=m.id;return o}));el.closest('.field').hidden=S.machines.length<2}
function fillLocations(){
 const el=$('location'),prev=el.value,rows=S.locations.filter(x=>x.agent===S.agent);
 const groups=[['Общие',rows.filter(x=>x.scope==='user')],['Проекты',rows.filter(x=>x.scope!=='user')]].filter(g=>g[1].length);
 el.replaceChildren(...groups.map(([label,items])=>{const g=node('optgroup',null,null,{label});g.append(...items.map(l=>{const o=node('option',locLabel(l));o.value=l.id;return o}));return g}));
 const twin=prev.replace(/^(codex|claude):/,S.agent+':');
 if(rows.some(x=>x.id===prev))el.value=prev;else if(rows.some(x=>x.id===twin))el.value=twin;
 for(const b of document.querySelectorAll('[data-agent]')){const on=b.dataset.agent===S.agent;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1}
}
function controls(){
 // aria-disabled instead of disabled: a focused control keeps keyboard focus while the list reloads
 const mark=(el,on)=>on?el.setAttribute('aria-disabled','true'):el.removeAttribute('aria-disabled'),write=!!S.pending;
 for(const id of['machine','location'])$(id).disabled=write;
 document.querySelectorAll('[data-agent]').forEach(b=>mark(b,write));
 mark($('refresh'),write);mark($('add'),write||S.loading||!S.data);
 $('list').setAttribute('aria-busy',String(S.loading));
 $('list').classList.toggle('loading',S.loading&&!!S.data);
}

async function loadMachines(){
 S.loading=true;controls();renderList();
 try{S.machines=await api('machines');fillMachines();await loadLocations()}
 catch(e){S.loading=false;S.error=e.message;controls();renderList()}
}
async function loadLocations(){
 const seq=++S.seq;S.loading=true;S.error=null;controls();renderList();
 try{const j=await api('locations?machine='+encodeURIComponent($('machine').value));if(seq!==S.seq)return;S.locations=j.locations;fillLocations();S.data=null;await loadServers()}
 catch(e){if(seq!==S.seq)return;S.data=null;S.error=e.message;S.loading=false;controls();renderList();showPath()}
}
async function loadServers(){
 const seq=++S.seq;S.loading=true;S.error=null;controls();renderList();
 try{
  if(!$('location').value)throw Error('Для этого агента на устройстве не найдено ни одного файла настроек.');
  const j=await api('servers?machine='+encodeURIComponent($('machine').value)+'&location='+encodeURIComponent($('location').value));
  if(seq!==S.seq)return;S.data=j;
 }catch(e){if(seq!==S.seq)return;S.data=null;S.error=e.message}
 S.loading=false;controls();renderList();showPath();
}
function showPath(){const p=$('path'),l=S.data?.location;p.hidden=!l;p.replaceChildren();if(!l)return;p.append(node('span','Файл: '),node('code',l.path));p.title=l.path;if(S.data.exists===false)p.append(node('span',' — будет создан при добавлении первого сервера'))}

/* ---------- Список ---------- */
function focusKey(){const a=document.activeElement,row=a&&a.closest&&a.closest('.row');return row?{name:row.dataset.name,role:a.dataset.role}:null}
function restoreFocus(key){if(!key)return;const rows=[...document.querySelectorAll('.row')];let row=rows.find(r=>r.dataset.name===key.name);if(row){row.querySelector('[data-role="'+key.role+'"]')?.focus();return}(rows[0]?.querySelector('[data-role=switch]')||$('add')).focus()}
function renderList(){
 const list=$('list'),all=S.data?.servers||[],key=focusKey();
 const on=all.filter(s=>s.enabled).length;$('count').textContent=S.data?(all.length?on+' из '+all.length+' вкл.':''):'';
 document.querySelectorAll('[data-filter]').forEach(b=>{const sel=b.dataset.filter===S.filter;b.setAttribute('aria-checked',String(sel));b.tabIndex=sel?0:-1});
 list.replaceChildren();
 if(!S.data){
  if(S.loading){for(let i=0;i<3;i++)list.append(node('li',null,'row skeleton',{'aria-hidden':'true'}));return}
  const li=node('li',null,'empty error');li.append(node('strong','Не удалось загрузить список'),node('span',S.error||''));li.append(button([icon('retry'),'Повторить'],'btn',()=>S.locations.length?loadServers():loadMachines()));list.append(li);return;
 }
 const q=$('search').value.trim().toLowerCase();
 const rows=all.filter(s=>(!q||(s.name+' '+s.endpoint).toLowerCase().includes(q))&&(S.filter==='all'||(S.filter==='on')===s.enabled));
 for(const s of rows)list.append(row(s));
 if(!rows.length){
  const li=node('li',null,'empty');
  if(!all.length){li.append(node('strong','Здесь пока нет серверов'),node('span','Добавьте сервер — агент сможет пользоваться его инструментами.'),button([icon('plus'),'Добавить сервер'],'btn primary',openEditor))}
  else{li.append(node('strong','Ничего не найдено'),button('Показать все','btn',()=>{$('search').value='';S.filter='all';renderList();$('search').focus()}))}
  list.append(li);
 }
 restoreFocus(key);
}
function row(s){
 const busy=S.pending&&S.pending.name===s.name,li=node('li',null,'row',{'data-name':s.name,'data-enabled':String(s.enabled)});
 if(busy)li.setAttribute('aria-busy','true');
 const kind=s.transport==='stdio'?'Программа':'Адрес';
 const info=node('div',null,'info'),title=node('div',null,'title');
 title.append(node('span',s.name,'name'),node('span',kind,'tag',{title:s.transport==='stdio'?'Запускается командой на устройстве':'Подключение по сетевому адресу ('+s.transport+')'}));
 const secrets=[...(s.envNames||[]),...(s.headerNames||[])];
 if(s.hasSecrets){const t=node('span',null,'tag lock',{title:'Значения скрыты'+(secrets.length?': '+secrets.join(', '):'')});t.append(icon('lock'),document.createTextNode(secrets.length?'ключи: '+secrets.length:'ключи'));title.append(t)}
 const ep=node('div',null,'endpoint');ep.append(icon(s.transport==='stdio'?'term':'globe'),node('span',s.endpoint||'—'));ep.title=s.endpoint||'';
 info.append(title,ep);
 const state=node('span',busy?'Сохраняю…':s.enabled?'Включён':'Выключен','state',{'aria-hidden':'true'});
 const sw=button(null,'switch',()=>toggle(s),{role:'switch','aria-checked':String(s.enabled),'aria-label':'Сервер '+s.name,'data-role':'switch',title:s.enabled?'Выключить':'Включить'});
 if(S.pending||S.loading)sw.setAttribute('aria-disabled','true');
 const del=button([icon('trash')],'btn ghost icon del',()=>askRemove(s),{'aria-label':'Удалить '+s.name,title:'Удалить','data-role':'delete'});
 if(S.pending||S.loading)del.setAttribute('aria-disabled','true');
 li.append(node('span',null,'dot',{'aria-hidden':'true'}),info,state,sw,del);
 return li;
}

/* ---------- Изменения ---------- */
async function mutate(action,input){
 try{await api(action,{machine:$('machine').value,location:$('location').value,version:S.data.version,...input});return {ok:true}}
 catch(e){if(CONFLICT.test(e.message)){await loadServers();return {ok:false,error:'Настройки изменились в другом месте — список обновлён. Повторите действие.'}}return {ok:false,error:e.message}}
}
async function toggle(s){
 if(S.pending||S.loading||!S.data)return;
 S.pending={name:s.name};notice('');controls();renderList();
 const r=await mutate('toggle',{name:s.name,enabled:!s.enabled});
 S.pending=null;
 if(r.ok){await loadServers();notice('«'+s.name+'» '+(s.enabled?'выключен.':'включён.')+' Изменение подхватят новые сессии агента.','ok')}
 else{controls();renderList();notice(r.error,'error')}
 restoreFocus({name:s.name,role:'switch'});
}
function askRemove(s){
 if(S.pending||S.loading)return;
 S.removing=s;$('remove-title').textContent='Удалить «'+s.name+'»?';
 $('remove-text').textContent='Сервер будет удалён из настроек '+(S.agent==='codex'?'Codex':'Claude')+': '+locLabel(S.data.location).toLowerCase()+(S.machines.length>1?' ('+machineLabel()+')':'')+'.';
 $('remove-error').textContent='';$('remove-confirm').disabled=false;$('remove-confirm').textContent='Удалить';
 $('remove').showModal();$('remove-cancel').focus();
}
$('remove-cancel').onclick=()=>$('remove').close();
$('remove').addEventListener('close',()=>{const s=S.removing;S.removing=null;if(s)restoreFocus({name:s.name,role:'delete'})});
$('remove-confirm').onclick=async()=>{
 const s=S.removing;if(!s||S.pending)return;
 S.pending={name:s.name};$('remove-confirm').disabled=true;$('remove-confirm').textContent='Удаляю…';controls();renderList();
 const r=await mutate('delete',{name:s.name});S.pending=null;
 if(r.ok){S.removing=null;$('remove').close();await loadServers();notice('«'+s.name+'» удалён. Резервная копия настроек сохранена.','ok');restoreFocus({name:'',role:'switch'})}
 else{controls();renderList();$('remove-error').textContent=r.error;$('remove-confirm').disabled=false;$('remove-confirm').textContent='Удалить'}
};

/* ---------- Добавление ---------- */
const F=$('form').elements,NAME_RE=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
function splitCommand(text){const out=[];let cur='',q=null,has=false;for(const ch of text.trim()){if(q){if(ch===q)q=null;else cur+=ch}else if(ch==='"'||ch==="'"){q=ch;has=true}else if(/\s/.test(ch)){if(cur||has){out.push(cur);cur='';has=false}}else cur+=ch}if(q)throw Error('В команде не закрыта кавычка');if(cur||has)out.push(cur);return out}
function transport(){const http=F.transport.value==='http';$('stdio-fields').hidden=http;$('http-fields').hidden=!http}
function showParsed(){const p=$('parsed');let parts=[];try{parts=splitCommand(F.command.value)}catch{p.hidden=false;p.replaceChildren(node('span','Не закрыта кавычка','bad'));return}
 p.hidden=parts.length<1;p.replaceChildren();if(!parts.length)return;
 p.append(node('span','Программа','k'),node('code',parts[0]));if(parts.length>1){p.append(node('span','аргументы','k'));for(const a of parts.slice(1))p.append(node('code',a))}}
function pairRow(kind,name='',value=''){
 const env=kind==='env',r=node('div',null,'pair');
 const n=node('input',null,'input mono',{'aria-label':env?'Имя переменной':'Название заголовка',placeholder:env?'API_KEY':'Authorization',autocomplete:'off',spellcheck:'false'});n.value=name;
 const v=node('input',null,'input mono',{'aria-label':'Значение',placeholder:env?'значение':'Bearer …',type:'password',autocomplete:'new-password',spellcheck:'false'});v.value=value;
 n.addEventListener('input',()=>{const d=env?'=':':',i=n.value.indexOf(d);if(i>0&&!v.value){v.value=n.value.slice(i+1).trim();n.value=n.value.slice(0,i).trim();v.focus()}});
 const rm=button([icon('x')],'btn ghost icon sm',()=>{const box=r.parentElement;r.remove();(box.querySelector('input')||box.nextElementSibling).focus()},{'aria-label':'Убрать строку',title:'Убрать'});
 r.append(n,v,rm);return r;
}
document.querySelectorAll('.add-pair').forEach(b=>b.onclick=()=>{const box=$(b.dataset.pairs+'-rows'),r=pairRow(b.dataset.pairs);box.append(r);r.querySelector('input').focus()});
function readPairs(kind){
 const out={},re=kind==='env'?/^[A-Za-z_][A-Za-z0-9_]*$/:/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
 for(const r of $(kind+'-rows').children){const[n,v]=r.querySelectorAll('input'),name=n.value.trim();if(!name&&!v.value)continue;
  if(!re.test(name))throw fieldError(n,kind==='env'?'Имя переменной: латинские буквы, цифры и «_», например API_KEY':'Название заголовка: латинские буквы, цифры и «-», например Authorization');
  if(name in out)throw fieldError(n,'«'+name+'» указан дважды');out[name]=v.value}
 return out;
}
function fieldError(el,text){const e=Error(text);e.field=el;return e}
function clearErrors(){$('form-error').textContent='';$('form').querySelectorAll('[aria-invalid]').forEach(e=>e.removeAttribute('aria-invalid'))}
function openEditor(){
 if(!S.data||S.pending||S.loading)return;
 $('form').reset();clearErrors();$('env-rows').replaceChildren();$('headers-rows').replaceChildren();transport();showParsed();
 $('editor-target').textContent=(S.agent==='codex'?'Codex':'Claude')+' · '+locLabel(S.data.location)+(S.machines.length>1?' · '+machineLabel():'');
 $('submit').disabled=false;$('submit').textContent='Добавить';
 $('editor').showModal();F.name.focus();
}
function buildConfig(){
 const name=F.name.value.trim();
 if(!name)throw fieldError(F.name,'Укажите название сервера');
 if(!NAME_RE.test(name))throw fieldError(F.name,'Название: только латинские буквы, цифры, «-» и «_», первым символом — буква или цифра');
 if((S.data?.servers||[]).some(s=>s.name===name))throw fieldError(F.name,'Сервер «'+name+'» уже есть в этих настройках');
 let extra={};
 if(F.extra.value.trim()){try{extra=JSON.parse(F.extra.value)}catch{throw fieldError(F.extra,'Дополнительные поля: это не JSON. Пример: {"startup_timeout_sec": 20}')}
  if(!extra||typeof extra!=='object'||Array.isArray(extra))throw fieldError(F.extra,'Дополнительные поля должны быть объектом JSON в фигурных скобках')}
 let config;
 if(F.transport.value==='http'){
  const url=F.url.value.trim();let ok=false;try{ok=/^https?:$/.test(new URL(url).protocol)}catch{}
  if(!ok)throw fieldError(F.url,'Укажите адрес, начинающийся с http:// или https://');
  config={type:'http',...extra,url};const headers=readPairs('headers');if(Object.keys(headers).length)config.headers=headers;
 }else{
  let parts;try{parts=splitCommand(F.command.value)}catch(e){throw fieldError(F.command,e.message)}
  if(!parts.length||!parts[0])throw fieldError(F.command,'Укажите команду запуска, например: npx -y @modelcontextprotocol/server-memory');
  config={...extra,command:parts[0]};if(parts.length>1)config.args=parts.slice(1);
  const env=readPairs('env');if(Object.keys(env).length)config.env=env;
 }
 return {name,config};
}
F.transport.forEach(r=>r.onchange=()=>{transport();clearErrors()});
F.command.addEventListener('input',showParsed);
F.name.addEventListener('input',()=>{const v=F.name.value.replace(/\s+/g,'-');if(v!==F.name.value){const p=F.name.selectionStart;F.name.value=v;F.name.setSelectionRange(p,p)}});
$('form').addEventListener('input',e=>{if(e.target.getAttribute('aria-invalid')){e.target.removeAttribute('aria-invalid');$('form-error').textContent=''}});
$('cancel').onclick=()=>$('editor').close();
$('editor').addEventListener('close',()=>{if(!S.pending)$('add').focus()});
$('form').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();$('form').requestSubmit()}});
$('form').onsubmit=async e=>{
 e.preventDefault();if(S.pending)return;clearErrors();
 let req;try{req=buildConfig()}catch(err){$('form-error').textContent=err.message;if(err.field){err.field.setAttribute('aria-invalid','true');err.field.closest('details')?.setAttribute('open','');err.field.focus()}return}
 S.pending={name:req.name};$('submit').disabled=true;$('submit').textContent='Добавляю…';controls();
 const r=await mutate('add',req);S.pending=null;
 if(r.ok){$('editor').close();if(S.filter==='off')S.filter='all';$('search').value='';await loadServers();notice('«'+req.name+'» добавлен и включён. Агент увидит его в новой сессии.','ok');restoreFocus({name:req.name,role:'switch'})}
 else{controls();$('submit').disabled=false;$('submit').textContent='Добавить';$('form-error').textContent=r.error;if(/имен/i.test(r.error)){F.name.setAttribute('aria-invalid','true');F.name.focus()}}
};

/* ---------- Навигация и клавиатура ---------- */
function setAgent(agent){if(S.pending||agent===S.agent)return;S.agent=agent;store.set('agent',agent);fillLocations();notice('');loadServers()}
for(const b of document.querySelectorAll('[data-agent]'))b.onclick=()=>setAgent(b.dataset.agent);
function arrows(e,sel,pick){const items=[...document.querySelectorAll(sel)],i=items.indexOf(document.activeElement);if(i<0)return;let j={ArrowLeft:i-1,ArrowUp:i-1,ArrowRight:i+1,ArrowDown:i+1,Home:0,End:items.length-1}[e.key];if(j===undefined)return;e.preventDefault();j=(j+items.length)%items.length;pick(items[j]);items[j].focus()}
document.querySelector('.agent-tabs').addEventListener('keydown',e=>arrows(e,'[data-agent]',b=>setAgent(b.dataset.agent)));
document.querySelector('.filter').addEventListener('keydown',e=>arrows(e,'[data-filter]',b=>{S.filter=b.dataset.filter;renderList()}));
document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{S.filter=b.dataset.filter;renderList()});
$('machine').onchange=loadLocations;$('location').onchange=()=>{notice('');loadServers()};
$('refresh').onclick=()=>{if(S.pending)return;notice('');loadServers()};$('add').onclick=openEditor;$('search').oninput=renderList;
$('close').onclick=()=>parent.postMessage({type:'oly-mcp-close'},'*');
addEventListener('keydown',e=>{
 if(document.querySelector('dialog[open]'))return;
 const t=e.target,typing=t instanceof HTMLInputElement||t instanceof HTMLTextAreaElement||t instanceof HTMLSelectElement;
 if((e.key==='/'&&!typing)||(e.key.toLowerCase()==='f'&&(e.ctrlKey||e.metaKey))){e.preventDefault();$('search').focus();$('search').select();return}
 if(e.key==='Escape'){if(t===$('search')&&t.value){e.preventDefault();t.value='';renderList();return}if(!typing&&parent!==window)parent.postMessage({type:'oly-mcp-close'},'*')}
});
loadMachines();
})();

;(()=>{try{
if(globalThis.__olyReferences)return;
const SEARCH=[
 ['web','Интернет','Веб-страницы и новости','web_search'],
 ['reddit','Reddit','Обсуждения и сообщества','reddit_search'],
 ['x','X','Публикации и обсуждения','x_search'],
 ['youtube','YouTube','Видео и каналы','youtube_search'],
 ['hn','Hacker News','Технологии и стартапы','hackernews_search']
];
function editor(){const a=document.activeElement;return a?.closest?.('[data-testid="composer-editor"],.composer-tiptap')||document.querySelector('[data-testid="composer-editor"],.composer-tiptap')}
function trigger(marker='@'){
 const el=editor(),ed=el?.editor;if(!ed?.state||!ed.state.selection.empty)return null;
 const s=ed.state.selection,b=s.$from.parent.textBetween(0,s.$from.parentOffset,undefined,n=>n.type.name==='hardBreak'?'\n':'\ufffc');
 const m=(marker==='!'?/(?:^|\s)!([^\s!]*)$/:/(?:^|\s)@([^\s@]*)$/).exec(b);
 return m?{el,ed,from:s.from-m[1].length-1,to:s.from,raw:m[1]}:null;
}
function insert(t,kind,id,label,source){
 if(!t?.ed)return false;
 return t.ed.chain().focus().insertContentAt({from:t.from,to:t.to},[
  {type:'composer-context-reference',attrs:{kind:'oly-'+kind,contextId:id,label,source}},
  {type:'text',text:' '}
 ]).run();
}
// Keep sources readable to agents and recover the same chips after drafts reload.
function lex(text,base){
 function plain(value){
  const result=[];
  let end=0;
  for(const m of value.matchAll(/!режим:(brainstorm|bug-hunter|design-plan) \(([^\r\n]*)\)/gu)){
   if(m[2]!==MODE_INSTRUCTIONS[m[1]])continue;
   if(m.index>end)result.push(...base(value.slice(end,m.index)));
   result.push({type:'context-reference',kind:'oly-mode',contextId:m[1],label:MODE_CHIPS[m[1]],source:m[0]});
   end=m.index+m[0].length;
  }
  if(end<value.length)result.push(...base(value.slice(end)));
  return result;
 }
 const re=/@openrouter:([^\s()]+)\s*\([^\n)]*\)|@(машина|устройство):«([^»\n]+)»\s*(?:\[[^\]\n]*\]|\([^\n)]*(?:\([^\n)]*\)[^\n)]*)?\))|!(web|reddit|x|youtube|hn)\s*\(поиск через oly-web\.[a-z_]+\)/g;
 let out=[],pos=0,m;
 while((m=re.exec(text))){
  if(m.index>pos)out.push(...plain(text.slice(pos,m.index)));
  const search=m[4]&&SEARCH.find(x=>x[0]===m[4]);
  out.push({type:'context-reference',kind:'oly-'+(m[1]?'model':search?'search':'machine'),contextId:m[1]||m[3]||m[4],label:m[1]?m[1].split('/').pop():search?search[1]:m[3],source:m[0]});pos=re.lastIndex;
 }
 if(pos<text.length)out.push(...plain(text.slice(pos)));return out;
}
const R=globalThis.__olyReferences={editor,trigger,insert,lex,search:SEARCH};
let category='files',lastEditor=null,nav=null,layer=null,raf=0;
const M=globalThis.__olyMentions={get category(){return category},select(v){category=v;schedule();document.dispatchEvent(new Event('selectionchange'))}};
function button(label,click){const b=document.createElement('button');b.type='button';b.textContent=label;b.onmousedown=e=>e.preventDefault();b.onclick=click;return b}
function mentions(){
 const t=trigger(),l=document.querySelector('[data-composer-drawer-layer]');
 if(!t||!l||!l.querySelector('[data-composer-command-drawer]')){if(layer)layer.removeAttribute('data-oly-mention-view');nav?.remove();nav=null;lastEditor=null;layer=null;category='files';return}
 if(lastEditor!==t.ed){category=/^(?:or|openrouter):/i.test(t.raw)?'models':'files';lastEditor=t.ed}
 if(/^(?:or|openrouter):/i.test(t.raw))category='models';
 layer=l;if(l.dataset.olyMentionView!==category)l.dataset.olyMentionView=category;
 if(!nav){nav=document.createElement('div');nav.className='oly-context-tabs';nav.setAttribute('role','tablist');nav.setAttribute('aria-label','Тип контекста');
  for(const [v,label] of [['files','Файлы'],['machines','Серверы'],['models','Модели']]){const b=button(label,()=>{category=v;schedule();document.dispatchEvent(new Event('selectionchange'))});b.dataset.view=v;b.setAttribute('role','tab');nav.append(b)}
 }
 if(nav.parentElement!==l)l.append(nav);
 for(const b of nav.children){const v=String(b.dataset.view===category);if(b.getAttribute('aria-selected')!==v)b.setAttribute('aria-selected',v)}
}
const MODES = {'':'Не переключать',default:'Выполнение',plan:'Планирование',brainstorm:'Мозговой штурм','bug-hunter':'Охотник за багами','design-plan':'Планирование дизайна'};
const MODE_CHIPS = {brainstorm:'✦ Мозговой штурм','bug-hunter':'🐞 Охотник за багами','design-plan':'❖ Планирование дизайна'};
const MODE_INSTRUCTIONS = {
 brainstorm:'используй скилл oly-brainstorming: не пиши код, задавай по 1 уточняющему вопросу за ход, предложи 2–3 подхода с компромиссами и защити спецификацию',
 'bug-hunter':'используй скилл oly-bug-hunter: проведи визуальный, технический и UX-аудит, собери доказательства файл:строка и выдай отчёт P0–P2 без правки кода до подтверждения',
 'design-plan':'используй скилл oly-design-planner: спроектируй UX-флоу и палитру, покажи интерактивный бренд-кит через html_preview/html_render и сгенерируй UI-мокапы через image_gen на модели codex/gpt-6.2-sol, не меняя рабочий код приложения'
};
const API = 'http://127.0.0.1:4517/api/prompts';
function node(tag, className, text) {
 const el=document.createElement(tag);
 if(className) el.className=className;
 if(text!==undefined) el.textContent=text;
 return el;
}
async function request(suffix='',value) {
 const response=await fetch(API+suffix,{cache:'no-store',signal:AbortSignal.timeout(8000),
  ...(value===undefined?{}:{method:'POST',headers:{'content-type':'application/json','x-oly':'1'},body:JSON.stringify(value)})});
 const data=await response.json();
 if(!response.ok) throw Error(data.error || 'Ошибка менеджера шаблонов');
 return data;
}
function searchSource(s){return '!'+s[0]+' (поиск через oly-web.'+s[3]+')'}
function atom(kind,id,label,source){
 return {type:'composer-context-reference',attrs:{kind:'oly-'+kind,contextId:id,label,source}};
}
function templateContent(body) {
 const nodes=[]; let size=0, cursor=null;
 function push(n){nodes.push(n);size+=n.type==='text'?n.text.length:1}
 function plain(text) {
  // Expand shorthand in templates only. Saved drafts are decoded by the existing lexer.
  const tokens=/\{\{cursor\}\}|\n|(?<![\p{L}\p{N}_/])!(web|reddit|x|youtube|hn)(?![\p{L}\p{N}_-])|(?<![\p{L}\p{N}_])@openrouter:([a-z0-9_-]+\/[a-z0-9_:.+-]*[a-z0-9_+-])/giu;
  let last=0;
  for(const m of text.matchAll(tokens)){
   if(m.index>last)push({type:'text',text:text.slice(last,m.index)});
   if(m[0]==='{{cursor}}'){if(cursor===null)cursor=size}
   else if(m[0]==='\n')push({type:'hardBreak'});
   else if(m[1]){const s=SEARCH.find(x=>x[0]===m[1].toLowerCase());push(atom('search',s[0],s[1],searchSource(s)))}
   else push(atom('model',m[2],m[2].split('/').pop(),'@openrouter:'+m[2]+' (модель OpenRouter)'));
   last=m.index+m[0].length;
  }
  if(last<text.length)push({type:'text',text:text.slice(last)});
 }
 for(const piece of lex(body.replace(/\r\n?/g,'\n'),s=>[{type:'text',text:s}])){
  if(piece.type==='text')plain(piece.text);
  else push({type:'composer-context-reference',attrs:{kind:piece.kind,contextId:piece.contextId,label:piece.label,source:piece.source}});
 }
 return {nodes,cursor:cursor??size};
}
function applyTemplate(t,p){
 const {nodes,cursor}=templateContent(p.body);
 const chain=t.ed.chain().focus();
 const range={from:t.from,to:t.to};
 const edit=nodes.length?chain.insertContentAt(range,nodes):chain.deleteRange(range);
 if(!edit.setTextSelection(t.from+cursor).run()||!p.mode)return;
 const ui=globalThis.__olyPlanUi;
 if(typeof ui?.setMode==='function'){ui.setMode(p.mode);return}
 const raw=location.hash.startsWith('#/')?location.hash.slice(1):location.pathname;
 const parts=raw.split(/[?#]/)[0].split('/').filter(Boolean);
 const id=parts[0]==='draft'?parts[1]:parts.length>=2?parts.at(-1):null;
 if(id){try{localStorage.setItem('oly-plan-v2:'+(parts[0]==='draft'?'draft:':'thread:')+decodeURIComponent(id),p.mode)}catch{}}
 if('__olyPlan' in globalThis&&(p.mode==='plan'||p.mode==='default'))globalThis.__olyPlan=p.mode==='plan';
}
function fieldText(t){
 // Work on a transaction snapshot. No dispatch, selection change or attachment cleanup.
 const doc=t.ed.state.tr.delete(t.from,t.to).doc;
 return doc.textBetween(0,doc.content.size,'\n',n=>{
  if(n.type.name==='hardBreak')return '\n';
  if(n.type.name==='composer-skill')return '$'+n.attrs.skillName;
  return n.attrs.source||'';
 });
}
let bang=null, options=[], active=0, sig='', dismissed=null, dialog=null;
let library=[], loadState='', loadIssue='', generation=0, menuEditor=null;
function closeBang(){bang?.remove();bang=null;sig='';menuEditor=null;generation++}
async function loadLibrary(){
 const ticket=++generation;
 loadState='loading';loadIssue='';
 try{
  const data=await request();
  if(ticket!==generation)return;
  library=data.prompts;loadState='ready';
  if(data.skipped?.length)loadIssue='Пропущены файлы: '+data.skipped.join(', ');
 }catch{if(ticket!==generation)return;library=[];loadState='error';loadIssue='Не удалось загрузить шаблоны'}
 if(ticket===generation){sig='';schedule()}
}
function openManager(t,fromField){
 const initial=fromField?fieldText(t):'';
 const remembered={editor:t.ed,location:location.href};
 dismissed={ed:t.ed,from:t.from,raw:t.raw};closeBang();
 const box=node('dialog','oly-prompt-dialog');dialog=box;
 box.setAttribute('aria-labelledby','oly-prompt-title');
 const top=node('header'),title=node('h2','','Управление шаблонами');title.id='oly-prompt-title';
 const close=button('Закрыть',()=>box.close());top.append(title,close);
 const form=node('form'); const choices=node('select');
 const name=node('input'),head=node('input'),desc=node('input'),mode=node('select'),body=node('textarea');
 name.maxLength=64;head.maxLength=120;desc.maxLength=350;name.required=head.required=body.required=true;
 name.placeholder='мой-шаблон';body.placeholder='Текст шаблона. {{cursor}} задаёт место ввода.';
 for(const [id,label] of Object.entries(MODES)) mode.add(new Option(label,id));
 function field(label,control){const wrap=node('label');wrap.append(node('span','',label),control);return wrap}
 const grid=node('div','oly-prompt-fields');grid.append(field('Команда после !',name),field('Режим ответа',mode));
 const status=node('div','oly-prompt-status');status.setAttribute('role','status');
 const foot=node('footer'),trash=button('В корзину',()=>commit(true)),save=node('button','oly-prompt-save','Сохранить');
 save.type='submit';foot.append(trash,save);
 form.append(field('Шаблон',choices),grid,field('Заголовок',head),field('Описание',desc),field('Текст шаблона',body),status,foot);
 box.append(top,form);document.body.append(box);
 let entries=[],current=null,busy=false;
 function fill(p){
  current=p||null;name.value=p?.name||'';name.readOnly=!!p;head.value=p?.title||'';
  desc.value=p?.description||'';mode.value=p?.mode||'';body.value=p?.body??'';trash.hidden=!p;
 }
 function populate(chosen){
  choices.replaceChildren(new Option('Новый шаблон',''));
  for(const p of entries)choices.add(new Option('!'+p.name+' · '+p.title,p.name));
  choices.value=chosen||'';fill(entries.find(p=>p.name===chosen));
 }
 function locked(on){busy=on;for(const el of form.elements)el.disabled=on}
 async function commit(deleting){
  if(busy||save.disabled||deleting&&!current)return;
  locked(true);status.textContent='';
  try{
   if(deleting){
    await request('/delete',{name:current.name,revision:current.revision});
    entries=entries.filter(p=>p.name!==current.name);populate('');status.textContent='Шаблон перемещён в корзину';
   }else{
    const saved=await request('',{name:name.value,title:head.value,description:desc.value,mode:mode.value,body:body.value,revision:current?.revision??null});
    entries=entries.filter(p=>p.name!==saved.name).concat(saved).sort((a,b)=>a.name.localeCompare(b.name,'ru'));
    populate(saved.name);status.textContent='Шаблон сохранён';
   }
   library=entries;
  }catch(e){status.textContent=e.message}
  finally{locked(false)}
 }
 choices.onchange=()=>{fill(entries.find(p=>p.name===choices.value));status.textContent=''};
 form.onsubmit=e=>{e.preventDefault();commit(false)};
 box.addEventListener('close',()=>{
  box.remove();dialog=null;
  if(t.el.isConnected&&remembered.location===location.href&&t.el.editor===remembered.editor)t.ed.commands.focus();
  schedule();
 },{once:true});
 populate('');body.value=initial;
 box.showModal();name.focus();
 // Fetch again so management also works when the first menu request is still pending.
 save.disabled=choices.disabled=true;
 request().then(data=>{
  if(!box.open)return;
  entries=data.prompts;for(const p of entries)choices.add(new Option('!'+p.name+' · '+p.title,p.name));
  if(data.skipped?.length)status.textContent='Пропущены файлы: '+data.skipped.join(', ');
 }).catch(()=>{if(box.open)status.textContent='Не удалось загрузить список шаблонов'}).finally(()=>{save.disabled=choices.disabled=false});
}
function bangTrigger(){
 if(dialog||!document.activeElement?.closest?.('[data-testid="composer-editor"],.composer-tiptap'))return null;
 return trigger('!');
}
function choose(i){
 const row=options[i],t=bangTrigger();
 if(!row||!t||t.ed!==menuEditor)return;
 if(row.action==='manage'||row.action==='save'){openManager(t,row.action==='save');return}
 if(row.action==='retry'){loadLibrary();schedule();return}
 if(row.prompt)applyTemplate(t,row.prompt);
 else{const s=row.search;insert(t,'search',s[0],s[1],searchSource(s))}
 closeBang();schedule();
}
function searches(){
 const t=bangTrigger();
 if(!t){if(bang)closeBang();if(!dialog&&!trigger('!'))dismissed=null;return}
 if(dismissed?.ed===t.ed&&dismissed.from===t.from&&dismissed.raw===t.raw)return;
 dismissed=null;
 if(!bang||t.ed!==menuEditor){
  closeBang();menuEditor=t.ed;
  bang=node('div','oly-search-menu');bang.setAttribute('role','listbox');bang.setAttribute('aria-label','Команды композера');
  bang.onmousedown=e=>e.preventDefault();document.body.append(bang);loadLibrary();
 }
 const key=JSON.stringify([t.raw,loadState,loadIssue]);
 const catalog=JSON.stringify([loadState,loadIssue]);
 if(!sig||bang.dataset.catalog!==catalog){
  bang.dataset.catalog=catalog;
  sig='';bang.replaceChildren();
  
  function row(parent,item,title,detail,shortcut){
   const b=button('',()=>choose(options.indexOf(item)));b.setAttribute('role','option');
   const copy=node('span','oly-prompt-copy');copy.append(node('strong','',title));if(detail)b.title=detail;
   b.dataset.filter=[title,shortcut,detail].filter(Boolean).join(' ').toLowerCase(); b.olyItem=item;
   b.append(copy);if(shortcut)b.append(node('kbd','','!'+shortcut));parent.append(b);
  }
  function group(label){const g=node('div','oly-prompt-group');g.setAttribute('role','group');g.setAttribute('aria-label',label);g.append(node('div','oly-search-heading',label));return g}
  const list=node('div','oly-prompt-options'),pg=group('Шаблоны промптов'),sg=group('Где искать');
  for(const p of library)row(pg,{prompt:p},p.title,p.description,p.name);
  if(loadIssue)pg.append(node('small','oly-prompt-note',loadIssue));
  if(loadState==='error')row(pg,{action:'retry'},'Повторить загрузку');
  if(pg.children.length===1)pg.append(node('small','oly-prompt-note',loadState==='loading'?'Загрузка…':'Шаблоны не найдены'));
  for(const s of SEARCH)row(sg,{search:s},s[1],s[2],s[0]);
  list.append(pg);if(sg.children.length>1)list.append(sg);
  const foot=node('footer');row(foot,{action:'save'},'+ Сохранить текст из поля как шаблон');row(foot,{action:'manage'},'Управление шаблонами');
  bang.append(list,foot);
  bang.rows=[...bang.querySelectorAll('button')].map(b=>{const slot=document.createComment('');b.before(slot);return {b,slot}});
 }
 if(sig!==key){
  sig=key;active=0;options=[];
  for(const {b,slot} of bang.rows){
   const visible=b.olyItem.action||b.dataset.filter.includes(t.raw.toLowerCase());
   if(visible&&!b.parentNode)slot.after(b);
   if(!visible&&b.parentNode)b.remove();
   if(visible)options.push(b.olyItem);
  }
 }
 for(const [i,b]of [...bang.querySelectorAll('button:not([hidden])')].entries()){
  const v=String(i===active);if(b.getAttribute('aria-selected')!==v)b.setAttribute('aria-selected',v);
 }
 const rect=t.el.closest('[data-slot=composer-host]')?.getBoundingClientRect()||t.el.getBoundingClientRect();
 const width=Math.min(356,innerWidth-24);
 const above=rect.top>=innerHeight-rect.bottom;
 Object.assign(bang.style,{left:Math.max(12,Math.min(rect.left,innerWidth-width-12))+'px',width:width+'px',
  maxHeight:Math.max(80,(above?rect.top:innerHeight-rect.bottom)-16)+'px',
  top:above?'auto':rect.bottom+6+'px',bottom:above?innerHeight-rect.top+6+'px':'auto'});
}

// Timeline renders user text with Markdown rather than the draft lexer. Keep the
// original React paragraph for copy/find and place a display-only chip beside it.
const bubbleSelector='[data-user-message-bubble]';
function syncBubble(bubble){
 for(const view of bubble.querySelectorAll('[data-oly-display]')){
  if(view.previousElementSibling!==view.olySource)view.remove();
 }
 for(const p of bubble.querySelectorAll('.user-message-markdown p')){
  let view=p.nextElementSibling;
  const ownView=view?.hasAttribute('data-oly-display')&&view.olySource===p;
  if(ownView&&view.olyMarkup===p.innerHTML)continue;
  const safe=/[!@]/.test(p.textContent)&&!p.querySelector(':not(br,strong,b,em,i,del,s,u,mark,code,kbd,sub,sup)');
  let count=0;
  const fragment=document.createDocumentFragment();
  if(safe){
   fragment.append(...Array.from(p.childNodes,n=>n.cloneNode(true)));
   const walker=document.createTreeWalker(fragment,NodeFilter.SHOW_TEXT);
   const texts=[];while(walker.nextNode())texts.push(walker.currentNode);
   for(const n of texts){
    if(n.parentElement?.closest('code,kbd'))continue;
    const parts=lex(n.data,text=>[{text}]);
    if(!parts.some(x=>x.kind&&x.kind!=='oly-mode'))continue;
    n.replaceWith(...parts.map(part=>{
     if(!part.kind)return document.createTextNode(part.text);
     count++;
     const chip=node('span','oly-reference-chip',part.label);chip.title=part.source;return chip;
    }));
   }
  }
  if(!count){
   if(ownView)view.remove();
   p.removeAttribute('data-oly-reference-source');continue;
  }
  if(!ownView){view=node('span');view.setAttribute('data-oly-display','');p.after(view)}
  view.olySource=p;view.olyMarkup=p.innerHTML;view.replaceChildren(fragment);
  p.setAttribute('data-oly-reference-source','');
 }
 const roots=bubble.querySelectorAll('.user-message-markdown');
 for(const root of roots){
  let p=root.lastElementChild;
  while(p?.tagName==='DIV')p=p.lastElementChild;
  if(p?.hasAttribute('data-oly-mode-chip'))p=p.previousElementSibling;
  const text=p?.tagName==='P'?p.textContent:'';
  const match=/^!режим:(brainstorm|bug-hunter|design-plan) \(([^\r\n]+)\)$/u.exec(text);
  const m=match&&(globalThis.__olyPlanUi?.modes?.find(item=>item.id===match[1])?.marker===text ||
   match[2]===MODE_INSTRUCTIONS[match[1]])?match:null;
  const old=root.querySelector('[data-oly-mode-chip]');
  if(old&&(!m||old.previousElementSibling!==p)){old.remove()}
  for(const el of root.querySelectorAll('[data-oly-mode-source]')){
   if(el!==p||!m)el.removeAttribute('data-oly-mode-source');
  }
  if(!m)continue;
  let chip=p.nextElementSibling;
  if(!chip?.hasAttribute('data-oly-mode-chip')){
   chip=node('span','oly-mode-chip');chip.setAttribute('data-oly-mode-chip','');p.after(chip);
  }
  if(!p.hasAttribute('data-oly-mode-source'))p.setAttribute('data-oly-mode-source','');
  if(chip.textContent!==MODE_CHIPS[m[1]])chip.textContent=MODE_CHIPS[m[1]];
  if(chip.title!==m[2])chip.title=m[2];
 }
}
function watchBubbles(){
 const pending=new Set();let frame=0;
 function queue(b){pending.add(b);if(!frame)frame=requestAnimationFrame(()=>{
  frame=0;for(const bubble of pending)if(bubble.isConnected)syncBubble(bubble);pending.clear();
 })}
 const observed=new WeakSet();
 function attach(b){
  if(!observed.has(b)){
   observed.add(b);
   new MutationObserver(()=>queue(b)).observe(b,{childList:true,characterData:true,subtree:true});
  }
  queue(b);
 }
 function mounted(el){
  if(el.matches(bubbleSelector))attach(el);
  else if(!globalThis.__olyCore?.isContentSubtree?.(el))el.querySelectorAll(bubbleSelector).forEach(attach);
 }
 document.querySelectorAll(bubbleSelector).forEach(attach);
 if(globalThis.__olyCore?.onUiMount)globalThis.__olyCore.onUiMount(batch=>batch.forEach(mounted));
 else new MutationObserver(records=>{
  for(const r of records)if(!r.target.closest?.('.chat-markdown,[data-user-message-bubble]'))
   for(const el of r.addedNodes)if(el.nodeType===1)mounted(el);
 }).observe(document.body,{childList:true,subtree:true});
}
function schedule(){if(raf)return;raf=requestAnimationFrame(()=>{raf=0;mentions();searches()})}
function start(){
 const s=document.createElement('style');s.id='oly-composer-v3';s.textContent=`
 [data-oly-mention-view]{display:flex!important;flex-direction:column;gap:0!important;max-height:min(410px,55vh);overflow:hidden;border:1px solid var(--border);border-radius:10px;background:var(--popover,var(--background))!important;box-shadow:0 12px 38px #0003;isolation:isolate}
 [data-oly-mention-view] [data-composer-command-drawer]{background:var(--popover,var(--background))!important;backdrop-filter:none!important;border:0!important;border-radius:0!important;box-shadow:none!important;overflow:auto;max-height:340px}
 .oly-context-tabs{display:flex;gap:4px;order:-100;padding:7px 9px;border-bottom:1px solid var(--border);background:var(--popover,var(--background));pointer-events:auto;flex:none}
 .oly-context-tabs button{padding:5px 12px;border-radius:6px;font:inherit;font-size:12px;font-weight:500;line-height:1.5;border:0;background:transparent;color:var(--muted-foreground);cursor:pointer}
 .oly-context-tabs button[aria-selected=true]{background:var(--accent);color:var(--foreground)}
 [data-oly-mention-view=files] [data-oly-machines=mention], [data-oly-mention-view=files] [data-oly-openrouter-section],
 [data-oly-mention-view=machines] [data-oly-openrouter-section], [data-oly-mention-view=machines] [data-composer-command-drawer]>:not([data-oly-machines=mention]),
 [data-oly-mention-view=models] [data-composer-command-drawer]{display:none!important}
 [data-oly-mention-view=models] .oly-or{max-height:340px;margin:0;border:0;border-radius:0;box-shadow:none;background:var(--popover,var(--background))!important}
 [data-oly-mention-view] .oly-mach-mention{border:0;background:var(--popover,var(--background));max-height:320px;overflow:auto}
 .oly-search-menu,.oly-prompt-dialog,.oly-mode-chip{--pr-bg:var(--popover,var(--background));--pr-fg:var(--foreground);--pr-muted:var(--muted-foreground);--pr-border:var(--border);--pr-accent:var(--primary);--pr-hover:var(--accent);--pr-shadow:0 10px 30px #0003;--pr-head:Georgia,serif}
 .oly-search-menu,.oly-prompt-dialog{box-sizing:border-box;padding:0;color:var(--pr-fg);background:var(--pr-bg);border:1px solid var(--pr-border);border-radius:2px;box-shadow:var(--pr-shadow);font:13px/1.4 Inter,system-ui,sans-serif}
 .oly-search-menu{position:fixed;z-index:9601;display:flex;flex-direction:column;overflow:hidden}
 .oly-prompt-options{min-height:0;overflow:auto;overscroll-behavior:contain;padding:5px}
 .oly-search-menu footer,.oly-prompt-dialog footer{display:flex;align-items:center;gap:4px;border-top:1px solid var(--pr-border);padding:6px}
 .oly-search-menu footer{flex-wrap:wrap}.oly-prompt-group:not(:has(button,.oly-prompt-note)){display:none}
 .oly-search-heading,.oly-prompt-dialog h2{font-family:var(--pr-head);font-weight:600;letter-spacing:var(--pr-tracking,.02em);text-transform:var(--pr-case,none)}
 .oly-search-heading{font-size:15px;padding:6px 8px 3px;color:var(--pr-accent)}
 .oly-search-menu button,.oly-prompt-dialog button{border:0;border-radius:2px;color:inherit;font:inherit;background:transparent;cursor:pointer;min-height:28px}
 .oly-search-menu button{display:flex;align-items:center;gap:8px;padding:4px 8px;text-align:left;width:100%}
 .oly-search-menu footer button{width:auto;font-size:12px;color:var(--pr-accent)}
 .oly-search-menu button[aria-selected=true],.oly-search-menu button:hover,.oly-prompt-dialog button:hover{background:var(--pr-hover)}
 .oly-search-menu button[aria-selected=true]{box-shadow:inset 2px 0 var(--pr-accent)}
 .oly-prompt-copy{flex:1;min-width:0}.oly-prompt-copy strong,.oly-prompt-copy small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 .oly-prompt-copy strong{font-weight:500}.oly-prompt-copy small,.oly-prompt-note,.oly-search-menu kbd{font-size:11px;color:var(--pr-muted)}
 .oly-prompt-note{display:block;padding:4px 8px}.oly-search-menu kbd{max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,monospace}
 .oly-prompt-dialog{width:min(560px,calc(100% - 24px));max-height:calc(100% - 24px);margin:auto;overflow:auto}
 .oly-prompt-dialog::backdrop{background:#07101e70}
 .oly-prompt-dialog header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 16px;border-bottom:1px solid var(--pr-border)}
 .oly-prompt-dialog h2{font-size:19px;margin:0}.oly-prompt-dialog button{padding:4px 9px}
 .oly-prompt-dialog form{display:grid;gap:10px;padding:12px 16px}
 .oly-prompt-fields{display:grid;grid-template-columns:1fr 1fr;gap:10px}
 .oly-prompt-dialog label{display:grid;gap:3px;min-width:0}.oly-prompt-dialog label span{color:var(--pr-muted);font-size:12px}
 .oly-prompt-dialog :is(input,select,textarea){box-sizing:border-box;width:100%;min-width:0;border:1px solid var(--pr-border);border-radius:2px;background:var(--pr-bg);color:var(--pr-fg);font:inherit;padding:4px 7px;min-height:29px}
 .oly-prompt-dialog textarea{min-height:92px;resize:vertical;line-height:1.5}
 .oly-prompt-dialog :focus-visible,.oly-search-menu :focus-visible{outline:2px solid var(--pr-accent);outline-offset:-2px}
 .oly-prompt-dialog footer{padding:8px 0 0;justify-content:space-between}.oly-prompt-dialog button[hidden]{display:none}
 .oly-prompt-dialog .oly-prompt-save{background:var(--pr-accent);color:var(--pr-btn-fg,var(--primary-foreground));margin-left:auto}
 .oly-prompt-status{color:var(--pr-muted)}.oly-prompt-status:empty{display:none}
 .oly-search-menu button[hidden], [data-oly-reference-source]{display:none!important}
 [data-oly-display]{display:block;white-space:pre-wrap}
 .oly-search-menu button{min-height:24px;padding-block:2px}
 .oly-context-tabs{padding:3px 5px}.oly-context-tabs button{padding:2px 8px}
 [data-oly-mention-view]{max-height:min(295px,45vh)}
 [data-user-message-bubble] [data-oly-mode-source]{display:none!important}
 .oly-mode-chip{display:table;max-width:100%;margin-top:6px;border:1px solid var(--pr-border);border-radius:2px;padding:2px 7px;background:var(--pr-bg);color:var(--pr-accent);font:500 12px/1.5 Inter,system-ui,sans-serif}
 @media(max-width:440px){.oly-prompt-fields{grid-template-columns:1fr}.oly-prompt-dialog header,.oly-prompt-dialog form{padding-left:12px;padding-right:12px}.oly-search-menu footer{gap:0}.oly-search-menu footer button{padding-block:2px}}
 .oly-reference-chip{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--border);background:var(--accent);color:var(--foreground);border-radius:6px;padding:1px 7px;font:inherit;font-size:.88em;font-weight:500;line-height:1.65;max-width:min(340px,85vw);overflow:hidden;text-overflow:ellipsis;vertical-align:baseline;white-space:nowrap}
 .oly-reference-chip,.oly-mode-chip{background:color-mix(in srgb,var(--primary) 9%,var(--background));border:1px solid color-mix(in srgb,var(--primary) 23%,var(--background));border-radius:5px;padding:0 5px;line-height:1.45}
 .oly-reference-chip::before{content:'◆';font-size:.68em;color:var(--primary)}
 .oly-reference-chip:is([title="YouTube"],[title^="!youtube "])::before{content:'▶'}
 .oly-reference-chip:is([title="Hacker News"],[title^="!hn "])::before{content:'Y';font-weight:bold}
 .oly-reference-chip:is([title="Интернет"],[title^="!web "])::before{content:'◎'}
 .oly-reference-chip:is([title="Reddit"],[title^="!reddit "])::before{content:'●';color:#e45d24}
 `;(document.head||document.documentElement).append(s);
 watchBubbles();
 const core=globalThis.__olyCore;
 if(core?.onUiMount)core.onUiMount(schedule);
 else new MutationObserver(records=>{
  if(records.some(r=>!r.target.closest?.('.chat-markdown,[data-user-message-bubble],.oly-search-menu,.oly-prompt-dialog,.xterm')))schedule();
 }).observe(document.body,{subtree:true,childList:true});
 const routeChanged=()=>{dismissed=null;closeBang();dialog?.close();schedule()};
 if(core?.onRoute)core.onRoute(routeChanged);
 else{addEventListener('hashchange',routeChanged);addEventListener('popstate',routeChanged)}
 document.addEventListener('selectionchange',schedule);document.addEventListener('input',schedule,true);
 document.addEventListener('focusin',schedule);document.addEventListener('focusout',schedule);
 addEventListener('resize',schedule);document.addEventListener('keyup',schedule,true);
 document.addEventListener('keydown',e=>{
  if(!bang||!bang.isConnected||e.isComposing||e.ctrlKey||e.metaKey||e.altKey||e.shiftKey)return;
  const t=bangTrigger();
  if(!t||t.ed!==menuEditor||!t.el.contains(e.target))return;
  if(sig!==JSON.stringify([t.raw,loadState,loadIssue]))searches();
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){
   active=(active+(e.key==='ArrowDown'?1:-1)+options.length)%options.length;
   bang.querySelectorAll('button:not([hidden])')[active]?.scrollIntoView({block:'nearest'});
  }else if(e.key==='Enter'||e.key==='Tab')choose(active);
  else if(e.key==='Escape'){dismissed={ed:t.ed,from:t.from,raw:t.raw};closeBang()}
  else return;
  e.preventDefault();e.stopImmediatePropagation();schedule();
 },true);schedule();
}
document.body?start():document.addEventListener('DOMContentLoaded',start,{once:true});
}catch(e){console.warn('oly composer',e)}})();

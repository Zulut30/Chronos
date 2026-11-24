;(()=>{try{
// Inline chat colors and standalone HTML for WordPress and other rich editors.
const C={red:['#C62828','#FF8A80'],orange:['#C25100','#FFB74D'],yellow:['#9A7300','#FFE082'],green:['#2E7D32','#81C784'],teal:['#00796B','#4DB6AC'],cyan:['#00838F','#80DEEA'],blue:['#1952C5','#8AB4FF'],purple:['#6A1B9A','#CE93D8'],pink:['#AD1457','#F48FB1'],gray:['#5B5F68','#B0BEC5'],gold:['#8A6A12','#E3BF5C'],brown:['#6D4C41','#BCAAA4']};
let day='',night='';
for(const[k,[d,n]]of Object.entries(C)){day+='--oly-c-'+k+':'+d+';--oly-bg-'+k+':color-mix(in srgb,'+d+' 16%,transparent);';night+='--oly-c-'+k+':'+n+';--oly-bg-'+k+':color-mix(in srgb,'+n+' 26%,transparent);'}
const css=':root{'+day+'}:root.dark{'+night+'}.chat-markdown mark{background:color-mix(in srgb,#F2C94C 45%,transparent);color:inherit;border-radius:3px;padding:0 .15em}:root.dark .chat-markdown mark{background:color-mix(in srgb,#E3BF5C 32%,transparent)}.chat-markdown u{text-decoration-thickness:1px;text-underline-offset:.18em}';
function addStyle(){if(document.getElementById('oly-rich-text'))return;const s=document.createElement('style');s.id='oly-rich-text';s.textContent=css;(document.head||document.documentElement).append(s)}
document.head?addStyle():addEventListener('DOMContentLoaded',addStyle);
const FMT='[data-oly-rich],mark,u';
const SAFE=new Set(['color','background-color','font-weight','font-style','text-decoration','text-decoration-line']);
function portableColor(mode,name,fallback){
 const key=name==='grey'?'gray':name,hex=C[key]?.[0]||fallback;
 if(mode==='c')return hex;
 if(/^#[0-9a-f]{6}$/i.test(hex))return '#'+[1,3,5].map(i=>Math.round(parseInt(hex.slice(i,i+2),16)*.16+255*.84).toString(16).padStart(2,'0')).join('');
 return fallback;
}
function portableStyle(value){
 return String(value).replace(/var\(--oly-(bg|c)-([a-z]+),\s*([a-z]+)\)/gi,(_,m,n,f)=>portableColor(m,n,f)).split(';').flatMap(part=>{
  const i=part.indexOf(':');if(i<1)return[];let k=part.slice(0,i).trim().toLowerCase(),v=part.slice(i+1).trim();
  if(k==='background')k='background-color';
  return SAFE.has(k)&&v&&!/var\(|color-mix\(|url\(|expression\(/i.test(v)?[k+':'+v]:[];
 }).join(';');
}
function serialize(root){
 const clone=root.cloneNode(true),els=[...(clone.nodeType===1?[clone]:[]),...clone.querySelectorAll('*')];
 for(const el of els){
  if(el.matches('button,svg,[aria-hidden="true"],script,style')){el.remove();continue}
  let style=portableStyle(el.getAttribute('style')||'');
  if(el.matches('mark'))style+=';background-color:#FFE58F';
  if(el.matches('u'))style+=';text-decoration:underline';
  for(const attr of [...el.attributes])if(attr.name==='class'||attr.name==='id'||attr.name.startsWith('data-')||attr.name.startsWith('on'))el.removeAttribute(attr.name);
  if(style)el.setAttribute('style',style.replace(/^;/,''));else el.removeAttribute('style');
 }
 const box=document.createElement('div');box.append(clone);
 return '<meta charset="utf-8">'+box.innerHTML;
}
function selectionPayload(){
 const selection=getSelection();if(!selection||selection.isCollapsed||selection.rangeCount!==1)return null;
 const range=selection.getRangeAt(0),element=n=>n.nodeType===1?n:n.parentElement;
 const start=element(range.startContainer),end=element(range.endContainer);
 if(!start||!end||start.closest('pre,code,[contenteditable="true"],textarea,input'))return null;
 const md=start.closest('.chat-markdown');if(!md||end.closest('.chat-markdown')!==md)return null;
 let fragment=range.cloneContents();
 if(!fragment.querySelector(FMT)&&!start.closest(FMT))return null;
 let ancestor=element(range.commonAncestorContainer);
 while(ancestor&&ancestor!==md&&md.contains(ancestor)){
  const shell=ancestor.cloneNode(false);shell.append(fragment);fragment=shell;ancestor=ancestor.parentElement;
 }
 return {plain:selection.toString(),html:serialize(fragment)};
}
addEventListener('copy',e=>{
 if(!e.clipboardData)return;const payload=selectionPayload();if(!payload)return;
 e.clipboardData.setData('text/plain',payload.plain);e.clipboardData.setData('text/html',payload.html);e.preventDefault();
},true);
let pending=null;
addEventListener('click',e=>{
 pending=null;const b=e.target instanceof Element&&e.target.closest('button');if(!b)return;
 const label=(b.getAttribute('aria-label')||'')+' '+(b.getAttribute('title')||'')+' '+(b.textContent||'');
 if(!/copy|копир/i.test(label))return;
 const row=b.closest('[data-timeline-row-id],[data-message-id]');
 const md=row?.querySelector('.chat-markdown');if(md?.querySelector(FMT))pending={md,at:Date.now()};
},true);
function take(){const p=pending;pending=null;return p&&Date.now()-p.at<4000&&p.md.isConnected?p.md:null}
const cb=navigator.clipboard;
if(cb&&cb.write&&typeof ClipboardItem!=='undefined'){
 const write=cb.write.bind(cb),writeText=cb.writeText?.bind(cb);
 function item(md,plain){return new ClipboardItem({'text/plain':new Blob([plain],{type:'text/plain'}),'text/html':new Blob([serialize(md)],{type:'text/html'})})}
 cb.write=async function(items){const md=take();if(!md)return write(items);const first=items[0];if(!first?.types?.includes('text/plain'))return write(items);
  const plain=await(await first.getType('text/plain')).text();
  return write([item(md,md.innerText||plain)]).catch(()=>write(items));
 };
 if(writeText)cb.writeText=function(text){const md=take();if(!md||typeof text!=='string')return writeText(text);
  return write([item(md,md.innerText||text)]).catch(()=>writeText(text));
 };
}
const WP_ROW = '[data-message-role="assistant"]';
const wpCss = document.createElement('style');
wpCss.textContent = `
.oly-wp-action{display:inline-flex;align-items:center;gap:4px;min-height:24px;background:transparent;color:var(--muted-foreground);border:0;padding:2px 6px;border-radius:2px;font:12px Inter,system-ui;cursor:pointer}
.oly-wp-action:hover,.oly-wp-action:focus-visible{color:var(--foreground);background:var(--accent)}
.oly-wp-action b{display:grid;place-items:center;border:1px solid currentColor;border-radius:100%;width:15px;height:15px;font:700 11px Georgia,serif}
.oly-wp-pop,.oly-wp-toast{box-sizing:border-box;color:var(--foreground,#0e1116);background:var(--card,#fffdf8);border:1px solid var(--border,#0e111626);border-radius:2px;font:13px/1.45 Inter,system-ui,sans-serif;box-shadow:3px 3px 0 #0e11160d,0 12px 32px -12px #0e111640}
.oly-wp-pop{position:fixed;inset:auto;margin:0;padding:16px;width:min(318px,calc(100vw - 16px));max-height:calc(100dvh - 16px);overflow:auto}
.oly-wp-pop::backdrop{background:transparent}
.oly-wp-pop h2{font:22px Georgia,serif;margin:0 0 12px}
.dark .oly-wp-pop h2{font:16px Didot,Georgia,serif;letter-spacing:.14em;text-transform:uppercase;color:var(--primary)}
.oly-wp-pop label{display:grid;gap:3px;margin:8px 0;color:var(--muted-foreground)}
.oly-wp-pop select,.oly-wp-pop input{box-sizing:border-box;width:100%;min-width:0;height:30px;border:1px solid var(--border);border-radius:2px;padding:0 6px;background:var(--background);color:var(--foreground);font:inherit}
.oly-wp-pop footer,.oly-wp-toast{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.oly-wp-pop footer{margin-top:14px;justify-content:flex-end}
.oly-wp-pop button,.oly-wp-toast button{cursor:pointer;padding:4px 9px;border:1px solid var(--border);border-radius:2px;color:inherit;background:transparent;font:inherit}
.oly-wp-pop button[type=submit]{background:var(--primary,#1952c5);color:var(--primary-foreground,#fff)}
.oly-wp-pop button:disabled{opacity:.55;cursor:default}
.oly-wp-pop [role=status]:empty{display:none}
.oly-wp-toast{position:fixed;right:12px;bottom:16px;max-width:calc(100vw - 24px);z-index:2147483646;padding:10px}
.oly-wp-toast button:first-of-type{color:var(--primary)}
`;
(document.head || document.documentElement).append(wpCss);

async function studio(path, data) {
 const config = data ? {method:'POST',headers:{'x-oly':'1','content-type':'application/json'},body:JSON.stringify(data)} : {cache:'no-store'};
 const response = await fetch('http://127.0.0.1:4520' + path, {...config, redirect:'error'});
 const json = await response.json();
 if (!response.ok) throw new Error(json.error || response.statusText);
 return json;
}
async function wordpressHtml(md) {
 const nodes=[...md.querySelectorAll('img')];
 if(!nodes.length)return serialize(md);
 const clone=md.cloneNode(true), images=[...clone.querySelectorAll('img')];
 for(let i=0;i<nodes.length;i++){
  const src=nodes[i].currentSrc || nodes[i].src;
  if(!src)continue;
  const url=new URL(src,location.href);
  const localAsset=(url.origin===location.origin || ['127.0.0.1','localhost'].includes(url.hostname)) &&
    /^\/(?:api\/assets|attachments)\//.test(url.pathname);
  if(!localAsset && !(url.protocol==='blob:' && url.origin===location.origin))continue;
  const response=await fetch(url,{redirect:'error'});
  if(!response.ok)throw new Error('Не удалось прочитать локальную иллюстрацию');
  const blob=await response.blob();
  if(blob.size>12*1024*1024)throw new Error('Иллюстрация больше 12 МБ');
  images[i].src=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob)});
 }
 return serialize(clone);
}
function wpToast(editUrl) {
 const box=document.createElement('div');
 box.className='oly-wp-toast'; box.setAttribute('role','status');
 box.innerHTML='<span>Черновик создан в Playground</span><button type="button">Открыть редактор →</button><button type="button" aria-label="Закрыть">×</button>';
 box.children[1].onclick=async()=>{
  try {
   const {delivered}=await studio('/api/open',{url:editUrl});
   if (!delivered) throw new Error('Окно T3 не подключено к студии');
   box.remove();
  } catch(e){box.children[0].textContent='Черновик сохранён. '+e.message}
 };
 box.lastElementChild.onclick=()=>box.remove();
 document.querySelector('.oly-wp-toast')?.remove(); document.body.append(box);
}
async function wpPopover(button,row) {
 document.querySelector('.oly-wp-pop')?.close();
 const md=row.querySelector('.chat-markdown');
 if (!md) return;
 const dialog=document.createElement('dialog'); dialog.className='oly-wp-pop';
 dialog.setAttribute('aria-label','Черновик в WordPress');
 dialog.innerHTML='<form><h2>В WordPress</h2><label>Локальный сайт<select name="site" required></select></label><label>Заголовок<input name="title" required maxlength="1000"></label><label>Тип материала<select name="type"><option value="post">Запись</option><option value="page">Страница</option></select></label><p role="status">Загрузка сайтов…</p><footer><button type="button">Отмена</button><button type="submit" disabled>Создать черновик</button></footer></form>';
 document.body.append(dialog);
 const form=dialog.firstElementChild, fields=form.elements, sites=fields.site, status=form.querySelector('[role=status]'), submit=form.querySelector('[type=submit]');
 const heading=md.querySelector('h1,h2')?.textContent?.trim();
 fields.title.value=heading || document.querySelector('[data-thread-item] [data-sidebar-row][aria-current]:not([aria-current="false"]) .truncate')?.textContent?.trim() || document.title || 'Черновик';
 const position=()=>{
  const box=button.getBoundingClientRect(), w=dialog.offsetWidth, h=dialog.offsetHeight;
  dialog.style.left=Math.max(8,Math.min(innerWidth-w-8,box.right-w))+'px';
  dialog.style.top=Math.max(8,Math.min(innerHeight-h-8,box.bottom+h+6<=innerHeight?box.bottom+6:box.top-h-6))+'px';
 };
 dialog.onclose=()=>{removeEventListener('resize',position);dialog.remove()};
 form.querySelector('[type=button]').onclick=()=>dialog.close();
 dialog.onclick=e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close()}};
 dialog.showModal();position();addEventListener('resize',position);
 form.onsubmit=async e=>{
  e.preventDefault();if(submit.disabled || !row.isConnected)return;
  submit.disabled=true; status.textContent='Создаю черновик…';
  try {
   const result=await studio('/api/wp/local-publish',{siteId:sites.value,title:fields.title.value.trim(),postType:fields.type.value,status:'draft',html:await wordpressHtml(md)});
   if(dialog.open)dialog.close(); wpToast(result.editUrl);
  } catch(err){status.textContent=err.message;submit.disabled=false}
 };
 try {
  const [list,ctx]=await Promise.all([studio('/api/wp/sites'),studio('/api/context').catch(()=>({}))]);
  if (!dialog.open) return;
  for(const site of list.sites) sites.add(new Option(site.name+(site.status==='running'?'':' · будет запущен автоматически'),site.id));
  const cwd=(globalThis.__olyStudio?.cwd || ctx.project?.root || ctx.cwd || '').replaceAll('\\','/').toLowerCase()+'/';
  const current=list.sites.find(s=>s.root && cwd.startsWith(s.root.replaceAll('\\','/').toLowerCase()+'/'));
  if(current)sites.value=current.id;
  if(!heading && ctx.title && (!ctx.threadId || ctx.threadId===globalThis.__olyStudio?.threadId))fields.title.value=ctx.title;
  status.textContent=list.sites.length?'':'Создайте локальный сайт во вкладке «Сайты WordPress» в Студии.';
  submit.disabled=!list.sites.length;position();fields.title.focus();
 } catch(err){status.textContent='Не удалось получить сайты. '+err.message;position()}
}
const wpRows=new Set();
let wpFrame=0;
function queueWpRow(row) {
 if(!row)return;wpRows.add(row);
 if(!wpFrame)wpFrame=requestAnimationFrame(()=>{
  wpFrame=0;
  for(const row of wpRows){
   if(!row.isConnected || row.querySelector('.oly-wp-action') || !row.querySelector('.chat-markdown'))continue;
   const copy=[...row.querySelectorAll('button')].find(b=>!b.closest('.chat-markdown') && /^(copy message|копировать сообщение|copy|копировать)$/i.test((b.getAttribute('aria-label')||b.title||b.textContent).trim()));
   if(!copy)continue;
   const button=document.createElement('button');
   button.type='button';button.className='oly-wp-action';button.title='Создать черновик в локальном Playground';
   button.innerHTML='<b aria-hidden="true">W</b>В WordPress';
   button.onclick=e=>{e.stopPropagation();wpPopover(button,row)};
   copy.after(button);
  }
  wpRows.clear();
 });
}
function wpMount(nodes) {
 for(const node of nodes){
  if(node.nodeType!==1 || node.closest('.oly-wp-action,.oly-wp-pop,.oly-wp-toast'))continue;
  const row=node.closest(WP_ROW);
  if(row)queueWpRow(row);else node.querySelectorAll(WP_ROW).forEach(queueWpRow);
 }
}
/* «В WordPress» under assistant answers is switched off (user, 2026-11-18): agents publish drafts through the studio MCP tool wp_publish_local_draft */
globalThis.__olyRichText={palette:C,serialize,selectionPayload,portableStyle};
}catch(e){console.warn('oly rich-text',e)}})();

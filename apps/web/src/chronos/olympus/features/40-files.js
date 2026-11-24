;(()=>{try{
/* 40-files: «Скачать» for files/folders of any T3 environment + project icon from the local disk.
   Data path = T3's own RPC over the app's WebSocket (assets.createUrl media-file → signed URL of the environment server),
   saved by the local files-service (127.0.0.1:4519) into Downloads; SSH/local disk only as service-side fallback. */
const G=globalThis;if(G.__olyFiles)return;
const SVC='http://127.0.0.1:4519';
const S={socks:new Set(),envByOrigin:new Map(),info:new Map(),pending:new Map(),seq:Math.floor(2e9+Math.random()*1e8),lastCwd:new Map(),projects:new Map()};
G.__olyFiles=S;
const hostOf=u=>{try{return new URL(u).host}catch(_){return ''}};

/* ---------- WebSocket capture + own RPC ---------- */
function upsertProject(env,p){if(!env||!p||typeof p.id!=='string'||typeof p.workspaceRoot!=='string')return;let m=S.projects.get(env);if(!m)S.projects.set(env,m=new Map());if(p.deletedAt)m.delete(p.id);else m.set(p.id,Object.assign(m.get(p.id)||{},p))}
const WALK=new Set(['values','value','snapshot','projects','project','payload','event','events','data','projectUpserted']);
function scanProjects(env,v,d){if(!v||typeof v!=='object'||d>6)return;if(Array.isArray(v)){for(const x of v)scanProjects(env,x,d+1);return}
 if(typeof v.workspaceRoot==='string'&&typeof v.id==='string'&&'title' in v){upsertProject(env,v);return}
 for(const k in v)if(WALK.has(k))scanProjects(env,v[k],d+1)}
function onMsg(ws,m,raw){if(!m||typeof m!=='object')return;const rid=m.requestId!=null?String(m.requestId):'';
 const p=rid&&S.pending.get(rid);
 if(p){if(m._tag==='Exit'){S.pending.delete(rid);const ex=m.exit||{};ex._tag==='Success'?p.res(ex.value):p.rej(new Error(errText(ex.cause)))}else if(m._tag==='Defect'){S.pending.delete(rid);p.rej(new Error('Ошибка сервера'))}return}
 if(m._tag!=='Chunk'||!Array.isArray(m.values))return;
 const host=hostOf(ws.url);
 for(const v of m.values){const c=v&&v.config,env=c&&c.environment;if(env&&env.environmentId){S.envByOrigin.set(host,env.environmentId);S.info.set(env.environmentId,{host,url:ws.url,label:env.label,os:env.platform&&env.platform.os,cwd:c.cwd,kb:c.keybindingsConfigPath})}}
 if(raw.indexOf('"workspaceRoot"')>=0){const e=S.envByOrigin.get(host);if(e)scanProjects(e,m.values,0)}}
function errText(c){try{const s=JSON.stringify(c);const m=s.match(/"message":"([^"]{1,300})"/)||s.match(/"_tag":"([A-Za-z]*Error)"/)||s.match(/"reason":"([^"]{1,120})"/);return m?m[1].replace(/\\\\/g,'\\'):s.slice(0,200)}catch(_){return 'Ошибка'}}
function feed(ws,st,d){if(typeof d!=='string')return;if(d.charCodeAt(0)===30){st.buf+=d.slice(1);if(st.buf.length>96e6)st.buf='';return}if(st.buf){d=st.buf+d;st.buf=''}
 if(S.pending.size===0&&d.indexOf('"serverVersion"')<0&&d.indexOf('"workspaceRoot"')<0)return;
 let o;try{o=JSON.parse(d)}catch(_){return}(Array.isArray(o)?o:[o]).forEach(x=>onMsg(ws,x,d))}
function sniffOut(ws,d){if(typeof d!=='string'||d.indexOf('"projects.listEntries"')<0)return;try{const o=JSON.parse(d);if(o.payload&&o.payload.cwd&&!o.payload.directoryPath)S.lastCwd.set(hostOf(ws.url),o.payload.cwd)}catch(_){}}
const NWS=window.WebSocket,nativeSend=NWS&&NWS.prototype.send;
if(NWS&&!NWS.__olyFiles){const W=function(...a){const ws=new NWS(...a);try{const st={buf:''};S.socks.add(ws);ws.addEventListener('message',e=>{try{feed(ws,st,e.data)}catch(_){}});ws.addEventListener('close',()=>S.socks.delete(ws));ws.send=function(d){try{sniffOut(ws,d)}catch(_){}return nativeSend.call(this,d)}}catch(_){}return ws};
 W.prototype=NWS.prototype;for(const k of['CONNECTING','OPEN','CLOSING','CLOSED'])W[k]=NWS[k];W.__olyFiles=true;if(NWS.__oly)W.__oly=true;window.WebSocket=W}
function sockFor(env){let any=null;for(const ws of S.socks){if(ws.readyState!==1)continue;const e=S.envByOrigin.get(hostOf(ws.url));if(e===env)return ws;if(!env&&!any)any=ws}return any}
S.rpc=(env,tag,payload,timeout)=>new Promise((res,rej)=>{const ws=sockFor(env);if(!ws)return rej(new Error('Нет соединения с окружением'));const id=String(++S.seq);
 const t=setTimeout(()=>{S.pending.delete(id);rej(new Error('Сервер окружения не ответил'))},timeout||30000);
 S.pending.set(id,{res:v=>{clearTimeout(t);res(v)},rej:e=>{clearTimeout(t);rej(e)}});
 nativeSend.call(ws,JSON.stringify({_tag:'Request',id:Number(id),tag,payload,headers:[]}))});
S.httpBase=env=>{const i=S.info.get(env);if(!i)return null;const u=new URL(i.url);u.protocol=u.protocol==='wss:'?'https:':'http:';u.pathname='/';u.search='';u.hash='';return u.toString()};
const sepOf=env=>{const i=S.info.get(env);return i&&i.os==='windows'?'\\':'/'};
const isAbs=p=>/^([A-Za-z]:[\\/]|\/|\\\\)/.test(p||'');
function joinP(env,base,rel){const s=sepOf(env);if(!rel)return base;return String(base).replace(/[\\/]+$/,'')+s+String(rel).replace(/^[\\/]+/,'').split(/[\\/]+/).join(s)}
const baseName=p=>String(p||'').replace(/[\\/]+$/,'').split(/[\\/]/).pop()||'download';
function route(){const s=(location.pathname+'/'+location.hash.replace(/^#\/?/,'')).split('/').filter(Boolean);const i=s.findIndex(x=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x));return i<0?{}:{env:s[i],thread:s[i+1]}}
function curEnv(){const r=route();if(r.env&&S.info.has(r.env))return r.env;if(S.info.size===1)return [...S.info.keys()][0];return r.env||null}
const cwdFor=env=>{const i=S.info.get(env);return i?S.lastCwd.get(i.host):null};
async function assetUrl(env,abs,thread){const v=await S.rpc(env,'assets.createUrl',{resource:{_tag:'media-file',threadId:thread||route().thread||'00000000-0000-0000-0000-000000000000',path:abs,disposition:'attachment'}});return new URL(v.relativeUrl,S.httpBase(env)).toString()}

/* ---------- local service ---------- */
let svcCache=null,svcAt=0;
async function svc(){if(Date.now()-svcAt<15000)return svcCache;svcAt=Date.now();try{const r=await fetch(SVC+'/health',{cache:'no-store'});svcCache=r.ok?await r.json():null}catch(_){svcCache=null}return svcCache}
async function post(p,b){const r=await fetch(SVC+p,{method:'POST',headers:{'content-type':'application/json','x-oly':'1'},body:JSON.stringify(b||{})});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||('Служба: '+r.status));return j}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function pollJob(job,t){t.cancel(()=>post('/cancel',{id:job.id}).catch(()=>{}));for(;;){const r=await fetch(SVC+'/job?id='+encodeURIComponent(job.id),{cache:'no-store'});const j=await r.json();
 if(j.state==='done'){t.cancel(null);return j}if(j.state==='cancelled')throw Object.assign(new Error('Отменено'),{cancelled:1});if(j.state==='error'){t.cancel(null);throw new Error(j.error||'Ошибка загрузки')}
 if(j.kind==='zip'&&j.files)t.progress(j.filesDone/j.files,`${j.filesDone} из ${j.files} файлов · ${fmt(j.bytes)}`);
 else if(j.total)t.progress(j.bytes/j.total,`${fmt(j.bytes)} из ${fmt(j.total)}`);else t.progress(null,fmt(j.bytes));
 await sleep(400)}}
const fmt=b=>b<1024?b+' Б':b<1048576?(b/1024).toFixed(1).replace('.',',')+' КБ':b<1073741824?(b/1048576).toFixed(1).replace('.',',')+' МБ':(b/1073741824).toFixed(2).replace('.',',')+' ГБ';
async function pool(items,n,fn){let i=0;const out=new Array(items.length);await Promise.all(Array.from({length:Math.min(n,items.length)},async()=>{while(i<items.length){const k=i++;out[k]=await fn(items[k],k)}}));return out}

/* ---------- download ---------- */
const busy=new Set();
async function download({env,abs,isDir,thread}){
 env=env||curEnv();const name=baseName(abs);const key=env+'|'+abs;if(busy.has(key))return;busy.add(key);
 const t=toast({title:(isDir?'Архивирую «':'Скачиваю «')+name+'»',desc:'Подготовка…',busy:true});
 try{
  if(!env||!S.info.has(env))throw new Error('Окружение не подключено');
  const sv=await svc();let forceT3=false;try{forceT3=localStorage.getItem('oly-files-mode')==='t3'}catch(_){}
  const absOk=isAbs(abs);const local=!!(absOk&&sv&&sv.localEnvId===env&&!forceT3);let job=null,url=null;
  const sshOk=async()=>!!(absOk&&sv&&!forceT3&&(await post('/ssh-target',{httpBase:S.httpBase(env)})).ok);
  const viaSsh=()=>post('/ssh',{httpBase:S.httpBase(env),path:abs,isDir});
  if(local)job=await post('/local',{envId:env,path:abs,isDir});
  else if(!isDir){
   let err=null;try{url=await assetUrl(env,abs,thread)}catch(e){err=e}
   if(!url&&absOk&&/NotFound/.test(err&&err.message||'')){let dir=false;try{await S.rpc(env,'projects.listEntries',{cwd:abs},20000);dir=true}catch(_){}if(dir){busy.delete(key);t.close();return download({env,abs,isDir:true,thread})}}
   if(url){if(sv)job=await post('/fetch',{url,name});else{const a=document.createElement('a');a.href=url;a.download=name;a.rel='noopener';document.body.appendChild(a);a.click();a.remove();t.done({title:'Загрузка «'+name+'» передана браузеру',desc:'Служба загрузок не запущена — файл сохранит браузер.'});return}}
   else if(await sshOk())job=await viaSsh();else throw err;
  }else{
   if(!sv)throw new Error('Для папок нужна служба загрузок (files-service, порт 4519).');if(!absOk)throw new Error('Не удалось определить полный путь папки');
   if(await sshOk())job=await viaSsh();
   else{const l=await S.rpc(env,'projects.listEntries',{cwd:abs},60000);const files=l.entries.filter(e=>e.kind==='file');
    if(l.truncated||files.length>5000)throw new Error(`В папке слишком много файлов (${l.truncated?'25000+':files.length}) для загрузки через T3.`);if(!files.length)throw new Error('Папка пуста');
    let n=0;const list=await pool(files,8,async f=>{const u=await assetUrl(env,joinP(env,abs,f.path),thread);n++;if(n%10===0||n===files.length)t.progress(n/files.length*.3,`Подготовка: ${n} из ${files.length}`);return{rel:f.path,url:u}});
    job=await post('/zip',{name,files:list})}
  }
  let j;try{j=await pollJob(job,t)}
  catch(e){if(!(url&&job.kind==='fetch'&&/ответил 40[13]/.test(e.message)))throw e;
   t.progress(null,'Скачиваю через окно T3…');const r=await fetch(url);if(!r.ok)throw new Error('Сервер окружения ответил '+r.status);const blob=await r.blob();
   const s2=await fetch(SVC+'/save?name='+encodeURIComponent(name),{method:'POST',headers:{'x-oly':'1','content-type':'application/octet-stream'},body:blob});const o=await s2.json();if(!s2.ok)throw new Error(o.error||'Служба: '+s2.status);j={path:o.path,bytes:blob.size}}
  const dir=j.path.replace(/[\\/][^\\/]*$/,''),inDl=sv&&sv.dest&&dir.toLowerCase()===String(sv.dest).toLowerCase();
  t.done({title:'Скачано: '+baseName(j.path),desc:(inDl?'В папке «Загрузки»':dir)+(j.bytes?' · '+fmt(j.bytes):''),reveal:j.path,full:j.path});
 }catch(e){if(e&&e.cancelled)t.fail('Загрузка «'+name+'» отменена','');else t.fail('Не удалось скачать «'+name+'»',e&&e.message||String(e))}
 finally{busy.delete(key)}}
S.download=download;

/* ---------- toasts ---------- */
const IC={dl:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/></svg>',
 ok:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>',
 err:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>',
 x:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
 img:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/></svg>'};
function el(tag,cls,html){const e=document.createElement(tag);if(cls)e.className=cls;if(html!=null)e.innerHTML=html;return e}
function host(){let h=document.getElementById('oly-files-toasts');if(!h){h=el('div','oly-files-toasts');h.id='oly-files-toasts';h.setAttribute('aria-live','polite');document.body.appendChild(h)}return h}
function toast({title,desc,busy}){const n=el('div','oly-ftoast'+(busy?' is-busy':''));
 n.innerHTML=`<span class="oly-ftoast-ic">${busy?IC.dl:IC.ok}</span><div class="oly-ftoast-body"><div class="oly-ftoast-t"></div><div class="oly-ftoast-d"></div><div class="oly-ftoast-bar"><i></i></div><div class="oly-ftoast-act"></div></div><button type="button" class="oly-ftoast-x" aria-label="Закрыть">${IC.x}</button>`;
 const q=s=>n.querySelector(s);q('.oly-ftoast-t').textContent=title||'';q('.oly-ftoast-d').textContent=desc||'';
 let timer=null;const close=()=>{clearTimeout(timer);n.classList.add('is-out');setTimeout(()=>n.remove(),180)};q('.oly-ftoast-x').onclick=close;
 host().appendChild(n);
 const api={cancel(fn){const a=q('.oly-ftoast-act');a.textContent='';if(fn){const b=el('button','oly-ftoast-btn','Отменить');b.type='button';b.onclick=()=>{b.disabled=true;b.textContent='Отменяю…';fn()};a.appendChild(b)}},
  progress(f,d){n.classList.toggle('is-indet',f==null);if(f!=null)q('.oly-ftoast-bar i').style.width=Math.max(2,Math.min(100,f*100)).toFixed(1)+'%';if(d!=null)q('.oly-ftoast-d').textContent=d},
  done({title,desc,reveal,full}){n.classList.remove('is-busy','is-indet');q('.oly-ftoast-ic').innerHTML=IC.ok;q('.oly-ftoast-t').textContent=title;q('.oly-ftoast-d').textContent=desc||'';q('.oly-ftoast-d').title=full||desc||'';
   const a=q('.oly-ftoast-act');a.textContent='';if(reveal){const b=el('button','oly-ftoast-btn','Показать в папке');b.type='button';b.onclick=()=>post('/reveal',{path:reveal}).catch(e=>api.fail('Не удалось открыть папку',e.message));a.appendChild(b)}
   timer=setTimeout(close,reveal?15000:7000);n.onmouseenter=()=>clearTimeout(timer);n.onmouseleave=()=>{timer=setTimeout(close,5000)}},
  fail(title,desc){n.classList.remove('is-busy','is-indet');n.classList.add('is-err');q('.oly-ftoast-ic').innerHTML=IC.err;q('.oly-ftoast-t').textContent=title;q('.oly-ftoast-d').textContent=desc||'';q('.oly-ftoast-act').textContent='';timer=setTimeout(close,12000)},close};
 return api}
S.toast=toast;

/* ---------- hover button: file tree rows + chat file links ---------- */
let fb=null,cur=null,hideT=null;
function floatBtn(){if(fb)return fb;fb=el('button','oly-dl-float',IC.dl);fb.type='button';fb.setAttribute('aria-label','Скачать');
 fb.addEventListener('mousedown',e=>{e.preventDefault();e.stopPropagation()});
 fb.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();if(cur)cur.act();hide(0)});
 fb.addEventListener('mouseenter',()=>clearTimeout(hideT));fb.addEventListener('mouseleave',()=>hide(200));document.body.appendChild(fb);return fb}
function show(target){const b=floatBtn();clearTimeout(hideT);cur=target;const r=target.rect;b.title=target.title;b.setAttribute('aria-label',target.title);
 b.style.left=Math.round(target.x)+'px';b.style.top=Math.round(r.top+(r.height-22)/2)+'px';b.classList.add('is-on')}
function hide(ms){clearTimeout(hideT);hideT=setTimeout(()=>{if(fb)fb.classList.remove('is-on');cur=null},ms)}
function treeTarget(path){let row=null,inTree=false;for(const n of path){if(!n||!n.getAttribute)continue;if(!row&&n.getAttribute('role')==='treeitem'&&n.hasAttribute('data-item-path'))row=n;if(n.localName==='file-tree-container'){inTree=true;break}}
 if(!row||!inTree)return null;const rel=row.getAttribute('data-item-path').replace(/\/+$/,'');const isDir=row.getAttribute('data-item-type')==='folder';const env=curEnv();const cwd=cwdFor(env);if(!cwd||!rel)return null;
 const r=row.getBoundingClientRect();return{key:row,rect:r,x:r.right-30,title:isDir?'Скачать папку (.zip)':'Скачать файл',act:()=>download({env,abs:joinP(env,cwd,rel),isDir})}}
function linkTarget(path){const a=path.find(n=>n&&n.classList&&n.classList.contains('chat-markdown-file-link'));if(!a)return null;let href=a.getAttribute('href')||'';try{href=decodeURI(href)}catch(_){}
 href=href.replace(/^file:\/\/\/?/,'').replace(/[#?].*$/,'').replace(/:\d+(:\d+)?$/,'');if(/^\/[A-Za-z]:\//.test(href))href=href.slice(1);
 const env=curEnv();if(!href||!env)return null;const abs=href;
 const r=a.getBoundingClientRect();return{key:a,abs,rect:r,x:Math.min(r.right+3,innerWidth-28),title:'Скачать «'+baseName(abs)+'»',act:()=>download({env,abs,isDir:false})}}
document.addEventListener('mouseover',e=>{try{const p=e.composedPath();if(fb&&p.includes(fb))return;const t=treeTarget(p)||linkTarget(p);if(t){if(!cur||cur.key!==t.key)show(t);else clearTimeout(hideT)}else if(cur)hide(220)}catch(_){}},true);
addEventListener('scroll',()=>{if(!cur)return;if(!cur.key.isConnected)return hide(0);const r=cur.key.getBoundingClientRect();if(r.bottom<0||r.top>innerHeight)return hide(0);const dy=r.top-cur.rect.top;if(Math.abs(dy)>.5&&fb){cur.rect=r;fb.style.top=Math.round(r.top+(r.height-22)/2)+'px'}},true);addEventListener('blur',()=>hide(0));

/* ---------- «Скачать» in T3's HTML context menus (chat links, explorer rows, changed files, diff headers, preview tab) ---------- */
let menuTarget=null;
function menuTargetFrom(path){const env=curEnv();if(!env)return null;const thread=route().thread;
 const lt=linkTarget(path);if(lt)return{env,abs:lt.abs,isDir:false,thread};
 let row=null,inTree=false;for(const n of path){if(!n||!n.getAttribute)continue;if(!row&&n.getAttribute('role')==='treeitem'&&n.hasAttribute('data-item-path'))row=n;if(n.localName==='file-tree-container'){inTree=true;break}}
 if(row&&inTree){const rel=row.getAttribute('data-item-path').replace(/\/+$/,''),isDir=row.getAttribute('data-item-type')==='folder',cwd=cwdFor(env);if(rel&&(cwd||!isDir))return{env,abs:cwd?joinP(env,cwd,rel):rel,isDir,thread}}
 for(const n of path){if(!n||!n.getAttribute)continue;
  if(n.hasAttribute('data-changed-file-row')){const rel=n.getAttribute('data-changed-file-row');const b=n.querySelector(':scope > button');if(rel&&!(b&&b.hasAttribute('aria-expanded')))return{env,abs:rel,isDir:false,thread};return null}
  if(n.hasAttribute('data-diffs-header')){const ti=n.querySelector('[data-title]');const rel=ti&&ti.textContent.trim().split(/\s+(?:→|->)\s+/).pop();return rel?{env,abs:rel,isDir:false,thread}:null}
  if(n.hasAttribute('data-active-tab')){if(n.getAttribute('data-active-tab')!=='true'||!n.closest('[data-right-panel-tab-list]'))return null;const sub=[...document.querySelectorAll('[data-surface-subheader]')].find(x=>x.querySelector('[data-file-breadcrumbs]'));if(!sub)return null;const c=crumbs(sub);if(c.length<2||c[c.length-1]!==n.textContent.trim())return null;return{env,abs:c.slice(1).join('/'),isDir:false,thread}}}
 return null}
document.addEventListener('contextmenu',e=>{try{const t=menuTargetFrom(e.composedPath());menuTarget=t?Object.assign(t,{at:Date.now()}):null}catch(_){menuTarget=null}},true);
const REVEAL_RE=/^(Показать в проводнике|Показать в Finder|Reveal in (File )?Explorer|Reveal in Finder|Show in (File )?(Explorer|Finder|folder)|Open containing folder)$/i;
function menuItemStyle(b,on){b.style.background=on?'var(--accent)':'transparent';b.style.color=on?'var(--contrast-accent-foreground)':'var(--contrast-foreground)'}
function closeMenu(b){try{b.focus({preventScroll:true})}catch(_){}document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))}
function addMenuItem(menu){if(menu.dataset.olyDl)return;menu.dataset.olyDl='1';const t=menuTarget;if(!t||Date.now()-t.at>2500)return;menuTarget=null;
 const items=[...menu.querySelectorAll(':scope > div > [role=menuitem]')];if(!items.length)return;
 const plain=items.filter(b=>!b.hasAttribute('aria-haspopup')&&!b.disabled);const tmpl=plain.find(b=>b.querySelector(':scope > svg'))||plain[0]||items[0];
 const b=tmpl.cloneNode(true);b.removeAttribute('aria-haspopup');b.removeAttribute('aria-expanded');b.removeAttribute('id');b.disabled=false;b.setAttribute('aria-disabled','false');b.classList.add('oly-menu-dl');
 b.querySelectorAll('[data-context-menu-chevron], span.ms-auto').forEach(x=>x.remove());
 const ic=b.querySelector(':scope > svg');if(ic){const cls=ic.getAttribute('class');ic.outerHTML=IC.dl.replace('<svg ','<svg class="'+cls+'" ')}
 const lab=b.querySelector('span.truncate')||b.querySelector('span');if(lab)lab.textContent='Скачать';b.title=t.isDir?'Скачать папку (.zip)':'Скачать файл';
 b.style.opacity='';b.style.pointerEvents='';menuItemStyle(b,false);
 let hov=false,foc=false;const upd=()=>menuItemStyle(b,hov||foc);
 b.addEventListener('mouseenter',()=>{b.focus({preventScroll:true});hov=true;upd()});b.addEventListener('mouseleave',()=>{hov=false;upd()});
 b.addEventListener('focus',()=>{foc=true;upd()});b.addEventListener('blur',()=>{foc=false;upd()});
 b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();closeMenu(b);download(t)});
 const ref=items.find(x=>REVEAL_RE.test(x.textContent.trim()));if(ref)ref.insertAdjacentElement('afterend',b);else items[0].insertAdjacentElement('beforebegin',b)}

/* ---------- file preview header button ---------- */
function crumbs(sub){return [...sub.querySelectorAll('li[data-file-crumb]')].map(li=>li.textContent.trim()).filter(Boolean)}
function addPreviewBtn(sub){if(sub.querySelector(':scope > .oly-dl-head'))return;const b=el('button','oly-dl-head',IC.dl);b.type='button';b.title='Скачать';b.setAttribute('aria-label','Скачать');
 b.onclick=e=>{e.preventDefault();const c=crumbs(sub);const env=curEnv();let cwd=cwdFor(env);
  if(!cwd&&c.length){const m=S.projects.get(env);for(const p of m?m.values():[])if(p.title===c[0]){cwd=p.workspaceRoot;break}}
  if(!cwd||c.length<1){toast({}).fail('Не удалось определить путь','Откройте панель «Файлы» этого треда и повторите.');return}
  const rel=c.slice(1).join('/');download({env,abs:joinP(env,cwd,rel),isDir:!rel})};
 sub.appendChild(b)}
function addExplorerBtn(sub){if(sub.querySelector(':scope > .oly-dl-head'))return;const b=el('button','oly-dl-head',IC.dl);b.type='button';b.title='Скачать всю папку (.zip)';b.setAttribute('aria-label','Скачать всю папку');
 b.onclick=e=>{e.preventDefault();const env=curEnv();const cwd=cwdFor(env);if(!cwd){toast({}).fail('Не удалось определить папку','Обновите список файлов и повторите.');return}download({env,abs:cwd,isDir:true})};sub.appendChild(b)}

/* ---------- project icon from this computer ---------- */
const ICON_RE=/^(Значок проекта|Project icon)$/,NAME_RE=/^(Имя|Name)$/;
const textBtns=r=>[...r.querySelectorAll('button')].filter(b=>!b.classList.contains('oly-icon-local')&&b.textContent.trim());
function rowOf(h,sel){let r=h;for(let i=0;i<7&&r;i++){r=r.parentElement;if(r&&(sel?r.querySelector(sel):textBtns(r).length))return r}return null}
function findRow(re,sel){const h=[...document.querySelectorAll('h3')].find(x=>re.test(x.textContent.trim()));return h?rowOf(h,sel):null}
function addIconBtn(){const row=findRow(ICON_RE);if(!row)return;const btns=textBtns(row);if(!btns.length)return;const last=btns[btns.length-1];
 const old=row.querySelector('.oly-icon-local');if(old){if(old.previousElementSibling===last)return;old.remove()}
 const b=el('button',(last.className||'')+' oly-icon-local');b.type='button';b.textContent='С компьютера';b.title='Выбрать изображение на этом компьютере';
 for(const a of['data-slot','data-variant','data-size'])if(last.hasAttribute(a))b.setAttribute(a,last.getAttribute(a));
 b.onclick=e=>{e.preventDefault();pickIcon(b)};last.insertAdjacentElement('afterend',b)}
function pickIcon(btn){const inp=el('input');inp.type='file';inp.accept='image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon,image/avif,.ico,.svg';inp.style.display='none';document.body.appendChild(inp);
 inp.onchange=async()=>{const f=inp.files&&inp.files[0];inp.remove();if(f)await applyIcon(f,btn)};inp.click();setTimeout(()=>inp.remove(),120000)}
function fileText(f){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(r.error);r.readAsText(f)})}
function fileUrl(f){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(r.error);r.readAsDataURL(f)})}
async function iconSvg(f){
 if((/svg/.test(f.type)||/\.svg$/i.test(f.name))&&f.size<400000){const t=await fileText(f);if(/<svg[\s>]/i.test(t))return t}
 const src=await fileUrl(f);const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error('Не удалось прочитать изображение'));i.src=src});
 const w0=img.naturalWidth||256,h0=img.naturalHeight||256,k=Math.min(1,256/Math.max(w0,h0)),w=Math.max(1,Math.round(w0*k)),h=Math.max(1,Math.round(h0*k));
 const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');g.imageSmoothingQuality='high';g.drawImage(img,0,0,w,h);const png=c.toDataURL('image/png');
 return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><image width="${w}" height="${h}" href="${png}" xlink:href="${png}"/></svg>`}
function t3Home(env){const i=S.info.get(env)||{};const s=sepOf(env);if(i.kb){const p=String(i.kb).split(/[\\/]/);if(p.length>2)return p.slice(0,-2).join(s)}return i.cwd?joinP(env,i.cwd,'.t3'):null}
async function applyIcon(f,btn){const nameRow=findRow(NAME_RE,'input');const inp=nameRow&&nameRow.querySelector('input');const title=inp&&(inp.value||inp.defaultValue||'').trim();
 const t=toast({title:'Устанавливаю значок…',desc:f.name,busy:true});t.progress(null);
 try{if(!title)throw new Error('Не найдено имя проекта на странице');
  const targets=[];for(const [env,m] of S.projects)for(const p of m.values())if(p.title===title&&!p.deletedAt&&S.info.has(env))targets.push({env,p});
  if(!targets.length)throw new Error('Проект «'+title+'» не найден среди подключённых окружений. Обновите страницу.');
  if(btn)btn.disabled=true;const svg=await iconSvg(f);if(svg.length>3e6)throw new Error('Изображение слишком большое');
  for(const {env,p} of targets){const home=t3Home(env);if(!home)throw new Error('Не удалось определить папку T3 окружения');
   const slug=(String(p.title||'project').replace(/[^\p{L}\p{N}_-]+/gu,'-').replace(/^-+|-+$/g,'').slice(0,40)||'project').toLowerCase();
   const file=slug+'-'+p.id.slice(0,8)+'-'+Date.now().toString(36)+'.svg';await S.rpc(env,'projects.writeFile',{cwd:home,relativePath:'olympus-icons/'+file,contents:svg});
   const fav=joinP(env,home,'olympus-icons/'+file);const r=await S.rpc(env,'projects.mutate',{type:'project.update',commandId:crypto.randomUUID(),projectId:p.id,faviconPath:fav,projectIcon:null});upsertProject(env,r)}
  t.done({title:'Значок проекта обновлён',desc:f.name+(targets.length>1?' · окружений: '+targets.length:'')})}
 catch(e){t.fail('Не удалось установить значок',e&&e.message||String(e))}finally{if(btn)btn.disabled=false}}
S.applyIcon=applyIcon;

/* ---------- styles + DOM watcher ---------- */
const CSS=`.oly-dl-float{position:fixed;z-index:9999;width:22px;height:22px;display:none;align-items:center;justify-content:center;padding:0;border:1px solid var(--border);border-radius:calc(var(--radius,8px) - 2px);background:var(--card,var(--background));color:var(--muted-foreground);cursor:pointer;box-shadow:0 1px 2px #0000001a}
.oly-dl-float.is-on{display:inline-flex}.oly-dl-float:hover{color:var(--foreground);background:var(--accent)}.oly-dl-float svg,.oly-dl-head svg{width:14px;height:14px}
.oly-dl-head{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:calc(var(--radius,8px) - 2px);background:transparent;color:var(--muted-foreground);cursor:pointer}.oly-dl-head:hover{background:var(--accent);color:var(--foreground)}
.oly-files-toasts{position:fixed;right:16px;bottom:16px;z-index:10050;display:flex;flex-direction:column;gap:8px;width:min(380px,calc(100vw - 32px));pointer-events:none}
.oly-ftoast{pointer-events:auto;position:relative;display:flex;gap:10px;align-items:flex-start;padding:12px 36px 12px 12px;border:1px solid var(--border);border-radius:var(--radius,8px);background:var(--popover,var(--card,var(--background)));color:var(--popover-foreground,var(--foreground));font:13px/1.4 var(--font-sans,Inter,system-ui,sans-serif);box-shadow:0 8px 28px -10px #00000040;animation:olyFtIn .18s ease-out}
.oly-ftoast.is-out{opacity:0;transform:translateY(6px);transition:all .18s}
@keyframes olyFtIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.oly-ftoast-ic{flex:none;width:16px;height:16px;margin-top:1px;color:var(--primary)}.oly-ftoast-ic svg{width:16px;height:16px}.oly-ftoast.is-err .oly-ftoast-ic{color:var(--destructive,#d33)}
.oly-ftoast-body{min-width:0;flex:1}.oly-ftoast-t{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.oly-ftoast-d{color:var(--muted-foreground);font-size:12px;overflow-wrap:anywhere;margin-top:2px}.oly-ftoast-d:empty{display:none}
.oly-ftoast-bar{display:none;height:3px;margin-top:8px;border-radius:2px;background:color-mix(in srgb,var(--muted-foreground) 18%,transparent);overflow:hidden}.oly-ftoast.is-busy .oly-ftoast-bar{display:block}
.oly-ftoast-bar i{display:block;height:100%;width:2%;background:var(--primary);transition:width .3s}.oly-ftoast.is-indet .oly-ftoast-bar i{width:30%!important;animation:olyFtInd 1.1s linear infinite}
@keyframes olyFtInd{from{transform:translateX(-100%)}to{transform:translateX(340%)}}
.oly-ftoast-act{display:flex;gap:6px;margin-top:8px}.oly-ftoast-act:empty{display:none}
.oly-ftoast-btn{height:28px;padding:0 10px;border:1px solid var(--border);border-radius:var(--control-radius,calc(var(--radius,8px) - 2px));background:transparent;color:var(--foreground);font:inherit;font-size:12.5px;font-weight:500;cursor:pointer}.oly-ftoast-btn:hover{background:var(--accent)}
.oly-ftoast-x{position:absolute;top:8px;right:8px;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:4px;background:transparent;color:var(--muted-foreground);cursor:pointer}.oly-ftoast-x:hover{background:var(--accent);color:var(--foreground)}.oly-ftoast-x svg{width:14px;height:14px}`;
function ensureCss(){if(document.getElementById('oly-files-css'))return;const s=el('style');s.id='oly-files-css';s.textContent=CSS;(document.head||document.documentElement).appendChild(s)}
let raf=0;function scan(){raf=0;try{ensureCss();for(const m of document.querySelectorAll('[data-context-menu][role=menu][data-level="0"]:not([data-oly-dl])'))addMenuItem(m);for(const sub of document.querySelectorAll('[data-surface-subheader]'))if(sub.querySelector('[data-file-breadcrumbs]'))addPreviewBtn(sub);else if(sub.querySelector('input[name="project-files-search"]'))addExplorerBtn(sub);if(location.pathname.indexOf('settings')>=0||location.hash.indexOf('settings')>=0)addIconBtn()}catch(e){console.warn('oly files scan',e)}}
const start=()=>{scan();new MutationObserver(muts=>{for(const m of muts)for(const n of m.addedNodes)if(n.nodeType===1&&n.getAttribute('data-context-menu')&&n.getAttribute('data-level')==='0')try{addMenuItem(n)}catch(e){console.warn('oly files menu',e)}if(!raf)raf=requestAnimationFrame(scan)}).observe(document.documentElement,{childList:true,subtree:true})};
if(document.body)start();else document.addEventListener('DOMContentLoaded',start,{once:true});
}catch(e){console.warn('oly files',e)}})();

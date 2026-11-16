from pathlib import Path
R=Path(__file__).parent
def patch(name,fn):
 p=R/'src'/name;s=p.read_text('utf8');p.write_text(fn(s),encoding='utf8')
def rep(s,a,b):
 assert s.count(a)==1,(a[:100],s.count(a));return s.replace(a,b)
def machines(s):
 discovery='''
// Read metadata through the desktop API; never persist credentials from its catalog.
let discovery=null,lastDiscovery=0;
async function discover(){
 if(discovery)return discovery;if(Date.now()-lastDiscovery<30000)return;
 lastDiscovery=Date.now();discovery=(async()=>{const bridge=window.desktopBridge;if(!bridge)return;
  let changed=false;
  function visit(x,mode,depth=0){if(!x||depth>7)return;
   if(Array.isArray(x)){for(const v of x)visit(v,mode,depth+1);return}
   if(typeof x==='string'){if(mode==='ssh'&&x.length<160&&!/[\\r\\n]/.test(x))changed=upsert({type:'env',name:x,sub:'SSH '+x,kind:'ssh'})||changed;return}
   if(typeof x!=='object')return;
   const target=x.target||x.connection||x;const rawName=x.name||x.label||x.displayName||x.alias||target.alias||target.hostAlias||target.host;
   const name=typeof rawName==='string'?rawName.slice(0,160):'';
   const host=target.hostname||target.host||target.hostAlias||target.alias;
   const kind=String(target.kind||target.type||x.kind||'');
   if(name&&(mode==='ssh'||/ssh/i.test(kind)||host)){
    const user=typeof target.username==='string'?target.username:typeof target.user==='string'?target.user:'';
    const dest=typeof host==='string'?host:name;const port=Number(target.port);
    changed=upsert({type:'env',name,sub:'SSH '+(user?user+'@':'')+dest+(port&&port!==22?':'+port:''),kind:'ssh'})||changed;
   }else if(name&&/local|embedded/i.test(kind))changed=upsert({type:'env',name,sub:'Этот компьютер',kind:'local'})||changed;
   for(const k of ['entries','environments','connections','hosts','items','catalog','sshHosts'])if(x[k])visit(x[k],mode,depth+1);
  }
  for(const [method,mode]of [['getConnectionCatalog','catalog'],['discoverSshHosts','ssh']]){
   try{if(typeof bridge[method]==='function')visit(await bridge[method](),mode)}catch{}
  }
  if(changed){saveKnown();schedule()}
 })().finally(()=>{discovery=null});return discovery;
}
'''
 s=rep(s,'// ---------- Settings rows: pencil button + inline rename ----------',discovery+'\n// ---------- Settings rows: pencil button + inline rename ----------')
 a=s.index('function reference(m)');b=s.index('function atQuery()',a)
 s=s[:a]+'''function reference(m){const shown=nameOf(m.name);const tag=m.type==='device'?'устройство':'машина';
 const details=m.kind==='local'?'этот компьютер, локально':m.kind==='ssh'?m.sub+'; подключение: '+sshCmd(m.sub):(m.platform||'окружение T3')+'; '+(m.sub||'');
 return '@'+tag+':«'+shown+'» ['+details.replace(/[\\[\\]\\r\\n]/g,' ')+']';}
'''+s[b:]
 a=s.index('function insert(m)');b=s.index('function hidePanel',a)
 s=s[:a]+'''function insert(m){const t=globalThis.__olyReferences?.trigger();if(!t)return;
 globalThis.__olyReferences.insert(t,'machine',m.name,nameOf(m.name),reference(m));hidePanel();}
'''+s[b:]
 s=rep(s,"const q=drawer&&atQuery();","const q=drawer&&atQuery();") if False else s
 s=rep(s,"if(!q){hidePanel();return}","if(!q||globalThis.__olyMentions?.category!=='machines'){hidePanel();return}discover();")
 s=rep(s,"const items=matchList(q.q).filter(m=>m.type!=='env'||!nat.includes(m.name));","const items=matchList(q.q);")
 s=rep(s,'if(!panel||!e.altKey||e.ctrlKey||e.metaKey)return;',"if(!panel||globalThis.__olyMentions?.category!=='machines'||!e.altKey||e.ctrlKey||e.metaKey)return;")
 s=rep(s,'const start=()=>{addStyle();', 'const start=()=>{discover();addStyle();')
 s=rep(s,'setAlias,reference};','setAlias,reference,reload:discover};')
 return s
def studio(s):
 s=rep(s,''' if(d.indexOf('"tag":"preview.')<0&&d.indexOf('"tag":"projects.readFile"')<0)return;''','')
 s=rep(s," const p=m&&m.payload||{};"," if(m._tag!=='Request')return;S.ws=ws;\n const p=m&&m.payload||{};")
 s=rep(s,"function routeThread(){const m=/^\\/([^/]+)\\/([0-9a-f-]{20,})$/i.exec(location.pathname);return m&&m[1]!=='draft'?m[2]:null}","function routeThread(){for(const p of [location.hash.replace(/^#/,''),location.pathname]){const m=/^\\/([^/]+)\\/([0-9a-f-]{20,})(?:[/?#]|$)/i.exec(p);if(m&&m[1]!=='draft')return m[2]}return null}")
 # Never fall back to a stale thread after navigating to a new draft.
 s=rep(s,'const curThread=()=>routeThread()||S.threadId;','const curThread=()=>routeThread();')
 s=rep(s," if(!threadId)throw new Error('Откройте тред — вкладка браузера привязана к треду');"," if(!threadId||!S.ws||S.ws.readyState!==1||document.querySelector('[data-oly-studio-overlay]'))return openOverlay(url,title);")
 s=rep(s," const res=await rpc('preview.open',{threadId,url,viewport:{_tag:'fill'},profileId:'default',...runtimeOpt(),...(runtimeOpt().runtime?{colorScheme:'system',zoomFactor:1}:{}),reveal:true});"," let res;try{res=await rpc('preview.open',{threadId,url,viewport:{_tag:'fill'},profileId:'default',...runtimeOpt(),...(runtimeOpt().runtime?{colorScheme:'system',zoomFactor:1}:{}),reveal:true},8000)}catch(e){return openOverlay(url,title)}")
 s=rep(s,"function report(e){toast(e&&e.message||String(e),true)}",'''function openOverlay(url,title){
 let box=document.querySelector('[data-oly-studio-overlay]');
 if(!box){box=document.createElement('div');box.setAttribute('data-oly-studio-overlay','');box.setAttribute('role','dialog');box.setAttribute('aria-label','Студия');
  Object.assign(box.style,{position:'fixed',inset:'34px 18px 18px',zIndex:145,display:'flex',flexDirection:'column',background:'var(--background)',border:'1px solid var(--border)',borderRadius:'12px',boxShadow:'0 18px 70px #0006',overflow:'hidden'});
  const bar=document.createElement('div');Object.assign(bar.style,{display:'flex',alignItems:'center',gap:'12px',padding:'10px 14px',borderBottom:'1px solid var(--border)',color:'var(--foreground)'});
  const label=document.createElement('b');label.textContent='Студия';label.style.flex='1';bar.append(label);
  for(const [text,fn]of [['Доски',()=>openHub('boards')],['WordPress',()=>openHub('wp')],['Закрыть',()=>box.remove()]]){const b=document.createElement('button');b.textContent=text;b.onclick=fn;b.style.cssText='padding:5px 10px;border:1px solid var(--border);border-radius:6px;cursor:pointer';bar.append(b)}
  const f=document.createElement('iframe');f.title='Студия';f.style.cssText='width:100%;flex:1;border:0;min-height:0';box.append(bar,f);document.body.append(box);
 }
 const f=box.querySelector('iframe');if(f.src!==url)f.src=url;return {overlay:true,url};
}
S.routeThread=routeThread;S.openOverlay=openOverlay;
function report(e){toast(e&&e.message||String(e),true)}''')
 s=rep(s,"b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();openPop(b)});", "b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();openHub('boards')});b.addEventListener('contextmenu',e=>{e.preventDefault();openPop(b)});")
 return s
def router(s):
 s=rep(s,"TTL = 6 * 3600e3, MAX_ITEMS = 40","TTL = 6 * 3600e3, MAX_ITEMS = 24")
 s=rep(s,"'oly-openrouter-catalog'","'oly-openrouter-catalog-v3'")
 s=rep(s,"const FILTERS =", "KIND.speech={label:'Озвучка',tool:'generate_speech',word:'speech',icon:KIND.text.icon};\nKIND.transcription={label:'Распознавание',tool:'transcribe_audio',word:'transcription',icon:KIND.text.icon};\nKIND.audio={label:'Аудио',tool:'generate_audio',word:'audio',icon:KIND.text.icon};\nconst FILTERS =")
 s=rep(s,"['decision', 'Решения']];","['speech', 'Озвучка'], ['transcription', 'Речь в текст'], ['audio', 'Аудио'], ['decision', 'Решения']];")
 s=rep(s,'function patchLogos() {','''function patchLogos() {
  for(const mine of document.querySelectorAll('[data-oly-or-logo]')){
   const host=mine.parentElement;if(host?.getAttribute('data-provider-accent-color')?.toLowerCase()===ACCENT.toLowerCase())continue;
   if(host)for(const ch of host.querySelectorAll(':scope > [data-oly-or-orig]'))ch.removeAttribute('data-oly-or-orig');mine.remove();
  }''')
 s=rep(s,"  return k;","  for(const v of ['speech','transcription','audio'])if(out.includes(v))k.push(v);\n  return k;")
 a=s.index('  const text = `@openrouter:');b=s.index('  const rec =',a)
 s=s[:a]+'''  const text = `@openrouter:${m.id} (${k.word}; MCP openrouter → ${k.tool})`;
  globalThis.__olyReferences?.insert(t,'model',m.id,m.name,text);
'''+s[b:]
 s=rep(s,"  loadCatalog();\n  if (!section)","  if(globalThis.__olyMentions?.category!=='models'&&!/^(or|openrouter):/i.test(t.raw)){hide();return}\n  loadCatalog();\n  if (!section)")
 s=rep(s,'  const nativeHasItems = !!layer.querySelector', '  const nativeHasItems = false && !!layer.querySelector')
 s=rep(s,"{ childList: true, subtree: true, characterData: true }","{ childList: true, subtree: true, characterData: true,attributes:true,attributeFilter:['data-provider-accent-color'] }")
 s=rep(s,'accent: ACCENT };','accent: ACCENT,kindsOf,patchLogos };')
 return s
patch('50-machines.js',machines)
patch('60-studio.js',studio)
patch('70-openrouter.js',router)
print('Feature changes staged')

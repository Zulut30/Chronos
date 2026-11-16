async function check(sources,catalog){
 const frame=document.createElement('iframe');frame.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:9999;background:white';document.body.append(frame);
 const w=frame.contentWindow,d=w.document;d.open();d.write('<!doctype html><html><head><style>:root{--background:#f3efe6;--popover:#fffdf8;--foreground:#0e1116;--muted-foreground:#5b5f68;--border:#d6cfbf;--accent:#e8e1d2}body{font:14px system-ui} [data-composer-drawer-layer]{position:absolute;bottom:160px;left:20px;width:650px} [data-slot=composer-host]{position:absolute;bottom:20px;left:20px;width:650px;height:110px;border:1px solid #aaa;padding:12px}</style></head><body><span id="provider" data-provider-accent-color="#6467F2"><svg id="native-logo"></svg></span><div data-composer-drawer-layer><div data-composer-command-drawer><div data-slot="command-item">file.ts</div></div></div><div data-slot=composer-host><div data-testid=composer-editor class=composer-tiptap contenteditable=true>@</div></div></body></html>');d.close();
 const results=[];const ok=(name,value)=>{results.push({name,pass:!!value});if(!value)throw Error(name)};const wait=()=>new Promise(r=>setTimeout(r,130));
 w.requestAnimationFrame=fn=>w.setTimeout(fn,8);w.cancelAnimationFrame=w.clearTimeout.bind(w);
 w.fetch=async()=>({ok:true,json:async()=>catalog});w.EventSource=class{addEventListener(){}close(){}};
 w.desktopBridge={getConnectionCatalog:async()=>JSON.stringify({entries:[{name:'Test Remote',target:{type:'ssh',host:'example.invalid',username:'test'},credential:'SECRET_CANARY'}]}),discoverSshHosts:async()=>[{alias:'ssh-alias',hostname:'alias.invalid'}]};
 w.WebSocket=class extends w.EventTarget{constructor(){super();this.readyState=1;this.url='ws://localhost/ws'}send(){}};
 const el=d.querySelector('.composer-tiptap');let value='@',inserted=null;
 const ed={get state(){return {selection:{empty:true,from:value.length+1,$from:{parent:{textBetween:()=>value},parentOffset:value.length}}}},chain(){return {focus(){return this},insertContentAt(range,content){inserted={range,content};value='';el.textContent='';return this},run(){return true}}}};el.editor=ed;
 function type(v){value=v;el.textContent=v;el.focus();const sel=w.getSelection(),r=d.createRange();r.selectNodeContents(el);r.collapse(false);sel.removeAllRanges();sel.addRange(r);d.dispatchEvent(new w.Event('selectionchange'));}
 for(const source of sources)w.eval(source);
 type('@');await wait();
 ok('bare_at_defaults_to_files',d.querySelector('[data-oly-mention-view=files]')&&!d.querySelector('.oly-or:not([hidden])'));
 ok('provider_openrouter_icon',d.querySelector('#provider > [data-oly-or-logo]'));
 d.querySelector('#provider').setAttribute('data-provider-accent-color','#888888');await wait();
 ok('provider_icon_restored_after_switch',!d.querySelector('#provider [data-oly-or-logo]')&&!d.querySelector('#native-logo').hasAttribute('data-oly-or-orig'));
 w.__olyMentions.select('machines');await wait();
 ok('machines_auto_discovery',w.__olyMachines.known.some(m=>m.name==='Test Remote')&&w.__olyMachines.known.some(m=>m.name==='ssh-alias'));
 ok('machine_credentials_not_persisted',!w.localStorage.getItem('oly-machines-known').includes('SECRET_CANARY'));
 ok('machines_tab_isolated',d.querySelector('[data-oly-mention-view=machines]')&&w.getComputedStyle(d.querySelector('[data-slot=command-item]')).display==='none');
 const remote=[...d.querySelectorAll('.oly-mach-item')].find(x=>x.textContent.includes('Test Remote'));remote.click();
 ok('machine_inserts_native_chip',inserted.content[0].type==='composer-context-reference'&&inserted.content[0].attrs.source.includes('example.invalid'));
 let source=inserted.content[0].attrs.source;ok('machine_draft_roundtrip',w.__olyReferences.lex(source,s=>[{type:'text',text:s}])[0].kind==='oly-machine');
 ok('legacy_machine_draft_becomes_chip',w.__olyReferences.lex('@машина:«Этот ПК» (этот компьютер, локально)',s=>[{type:'text',text:s}])[0].kind==='oly-machine');
 type('@Test');w.__olyMentions.select('machines');await wait();el.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));ok('machine_keyboard_inserts_visible_server',inserted.content[0].attrs.kind==='oly-machine'&&inserted.content[0].attrs.label==='Test Remote');
 { const drawer=d.querySelector('[data-composer-command-drawer]'),layerEl=drawer.parentElement;type('@Te');w.__olyMentions.select('machines');await wait();drawer.remove();d.dispatchEvent(new w.Event('selectionchange'));await wait();
   const ev=new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});el.dispatchEvent(ev);
   ok('machine_enter_not_swallowed_after_menu_closed',!ev.defaultPrevented&&w.__olyMentions.category==='files');layerEl.append(drawer);type('@');await wait(); }
 type('@');w.__olyMentions.select('models');await wait();await wait();
 ok('model_tab_isolated',w.getComputedStyle(d.querySelector('[data-composer-command-drawer]')).display==='none'&&d.querySelector('.oly-or'));
 ok('catalog_media_and_jev',catalog.data.some(m=>m.id.includes('typesafe/jev'))&&['speech','transcription','audio','video','image'].every(k=>catalog.data.some(m=>w.__olyOpenRouter.kindsOf(m).includes(k))));
 d.querySelector('.oly-or-item').click();ok('model_native_chip',inserted.content[0].attrs.kind==='oly-model'&&inserted.content[0].attrs.source.includes('MCP openrouter'));
 source=inserted.content[0].attrs.source;ok('model_draft_roundtrip',w.__olyReferences.lex(source,s=>[{type:'text',text:s}])[0].kind==='oly-model');
 type('!redd');await wait();ok('bang_filters_sources',d.querySelectorAll('.oly-search-menu button').length===1&&d.querySelector('.oly-search-menu').textContent.includes('Reddit'));
 el.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
 ok('bang_inserts_search_chip',inserted.content[0].attrs.kind==='oly-search'&&inserted.content[0].attrs.source.includes('oly-web.reddit_search'));
 ok('bang_draft_roundtrip',w.__olyReferences.lex(inserted.content[0].attrs.source,s=>[{type:'text',text:s}])[0].kind==='oly-search');
 w.location.hash='/environment/7a578a34-2668-47ea-b623-11e681d080b9';
 ok('studio_desktop_hash_route',w.__olyStudio.routeThread()==='7a578a34-2668-47ea-b623-11e681d080b9');
 const ws=new w.WebSocket();ws.send(JSON.stringify({_tag:'Request',tag:'server.getConfig',payload:{}}));ok('studio_acquires_normal_rpc_socket',w.__olyStudio.ws===ws);
 w.location.hash='/draft/new';const opened=await w.__olyStudio.openInPanel('http://127.0.0.1:4520/?tab=boards');
 ok('studio_without_thread_opens',opened.overlay&&d.querySelector('[data-oly-studio-overlay] iframe'));
 w.fetch=async url=>({ok:true,json:async()=>String(url).includes('/api/thread/')?{projectId:'current-project'}:String(url).endsWith('/api/projects')?[{id:'current-project',root:'C:/current-project'}]:{ok:true}});
 w.location.hash='/environment/7a578a34-2668-47ea-b623-11e681d080b9';w.__olyStudio.ws=null;w.__olyStudio.cwd='C:/stale-project';await w.__olyStudio.openHub('boards');ok('studio_resolves_current_project_before_open',new URL(d.querySelector('[data-oly-studio-overlay] iframe').src).searchParams.get('cwd')==='C:/current-project');
 frame.remove();return results;
}

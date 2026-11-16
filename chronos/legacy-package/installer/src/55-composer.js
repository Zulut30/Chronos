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
 const s=ed.state.selection,b=s.$from.parent.textBetween(0,s.$from.parentOffset,undefined,'\ufffc');
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
 const re=/@openrouter:([^\s()]+)\s*\([^\n)]*\)|@(машина|устройство):«([^»\n]+)»\s*(?:\[[^\]\n]*\]|\([^\n)]*(?:\([^\n)]*\)[^\n)]*)?\))|!(web|reddit|x|youtube|hn)\s*\(поиск через oly-web\.[a-z_]+\)/g;
 let out=[],pos=0,m;
 while((m=re.exec(text))){
  if(m.index>pos)out.push(...base(text.slice(pos,m.index)));
  const search=m[4]&&SEARCH.find(x=>x[0]===m[4]);
  out.push({type:'context-reference',kind:'oly-'+(m[1]?'model':search?'search':'machine'),contextId:m[1]||m[3]||m[4],label:m[1]?m[1].split('/').pop():search?search[1]:m[3],source:m[0]});pos=re.lastIndex;
 }
 if(pos<text.length)out.push(...base(text.slice(pos)));return out;
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
let bang=null,options=[],active=0,sig='',dismissed=null;
function closeBang(){bang?.remove();bang=null;sig=''}
function chooseSearch(i){const s=options[i],t=trigger('!');if(!s||!t)return;insert(t,'search',s[0],s[1],`!${s[0]} (поиск через oly-web.${s[3]})`);closeBang()}
function searches(){
 const t=trigger('!');if(!t||dismissed===`${t.from}:${t.raw}`){closeBang();if(!t)dismissed=null;return}
 options=SEARCH.filter(s=>(s[0]+' '+s[1]).toLowerCase().includes(t.raw.toLowerCase()));
 if(!bang){bang=document.createElement('div');bang.className='oly-search-menu';bang.setAttribute('role','listbox');bang.setAttribute('aria-label','Поиск');bang.onmousedown=e=>e.preventDefault();document.body.append(bang)}
 const key=t.raw;if(sig!==key||!bang.children.length){sig=key;active=0;bang.replaceChildren();const h=document.createElement('div');h.className='oly-search-heading';h.textContent='Где искать';bang.append(h);
  options.forEach((s,i)=>{const b=button('',()=>chooseSearch(i));b.setAttribute('role','option');const title=document.createElement('span');title.textContent=s[1];const detail=document.createElement('small');detail.textContent=s[2];const k=document.createElement('kbd');k.textContent='!'+s[0];b.append(title,detail,k);bang.append(b)});
  if(!options.length){const empty=document.createElement('div');empty.textContent='Ничего не найдено';empty.className='oly-search-heading';bang.append(empty)}
 }
 for(const [i,b]of [...bang.querySelectorAll('button')].entries()){const v=String(i===active);if(b.getAttribute('aria-selected')!==v)b.setAttribute('aria-selected',v)}
 const rect=t.el.closest('[data-slot=composer-host]')?.getBoundingClientRect()||t.el.getBoundingClientRect();
 Object.assign(bang.style,{left:Math.max(12,Math.min(rect.left,innerWidth-380))+'px',bottom:Math.max(12,innerHeight-rect.top+8)+'px',width:Math.min(440,innerWidth-24)+'px'});
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
 .oly-search-menu{position:fixed;z-index:160;padding:6px;background:var(--popover,var(--background));color:var(--foreground);border:1px solid var(--border);border-radius:10px;box-shadow:0 12px 38px #0003;font-size:13px;max-height:45vh;overflow:auto}
 .oly-search-heading{padding:5px 8px 8px;font-size:11px;color:var(--muted-foreground)}
 .oly-search-menu button{display:flex;align-items:center;gap:10px;width:100%;border:0;border-radius:6px;padding:9px 8px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
 .oly-search-menu button[aria-selected=true],.oly-search-menu button:hover{background:var(--accent)}
 .oly-search-menu small{color:var(--muted-foreground);font-size:11px;flex:1}.oly-search-menu kbd{font:11px ui-monospace,monospace;color:var(--muted-foreground)}
 .oly-reference-chip{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--border);background:var(--accent);color:var(--foreground);border-radius:6px;padding:1px 7px;font:inherit;font-size:.88em;font-weight:500;line-height:1.65;max-width:min(340px,85vw);overflow:hidden;text-overflow:ellipsis;vertical-align:baseline;white-space:nowrap}
 `;(document.head||document.documentElement).append(s);
 new MutationObserver(schedule).observe(document.body,{subtree:true,childList:true,characterData:true});
 document.addEventListener('selectionchange',schedule);document.addEventListener('input',schedule,true);document.addEventListener('keyup',schedule,true);
 document.addEventListener('keydown',e=>{if(!bang||!trigger('!')||e.isComposing||e.ctrlKey||e.metaKey||e.altKey)return;
  if(e.key==='ArrowDown'&&options.length)active=(active+1)%options.length;else if(e.key==='ArrowUp'&&options.length)active=(active+options.length-1)%options.length;
  else if((e.key==='Enter'&&!e.shiftKey||e.key==='Tab')&&options.length)chooseSearch(active);
  else if(e.key==='Escape'){const t=trigger('!');dismissed=`${t.from}:${t.raw}`;closeBang()}else return;
  e.preventDefault();e.stopImmediatePropagation();schedule();
 },true);schedule();
}
document.body?start():document.addEventListener('DOMContentLoaded',start,{once:true});
}catch(e){console.warn('oly composer',e)}})();

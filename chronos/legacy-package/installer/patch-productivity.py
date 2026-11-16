from pathlib import Path
R=Path(__file__).parent;BASE=R.parent
def rep(s,a,b):
 assert s.count(a)==1,(a[:120],s.count(a));return s.replace(a,b)
def before(name,p):
 dst=R/'before'/name
 if not dst.exists():dst.write_bytes(p.read_bytes())
 return dst.read_text('utf8')
s=before('tasks-store.mjs',BASE/'tasks-service/store.mjs')
s=rep(s,"pinned_at from projection_projects", "pinned_at, favicon_path, project_icon_json from projection_projects")
s=rep(s,"pinned: !!r.pinned_at }", "pinned: !!r.pinned_at,icon:projectIcon(r) }")
i=s.index('let projCache =')
s=s[:i]+'''function projectIcon(r){
 let custom;try{custom=JSON.parse(r.project_icon_json||'null')}catch{}
 if(custom)return custom;
 if(r.favicon_path){try{const f=path.isAbsolute(r.favicon_path)?r.favicon_path:path.resolve(r.root||'',r.favicon_path);const ext=path.extname(f).slice(1).toLowerCase();const mime={svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',ico:'image/x-icon'}[ext];if(mime&&fs.statSync(f).size<=512*1024)return {kind:'image',url:'data:'+mime+';base64,'+fs.readFileSync(f).toString('base64')}}catch{}}
 return null;
}
function dueDate(value){if(value==null||value==='')return null;const s=String(value);if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s)throw new Error('Неверная дата срока');return s}
function labels(value){return [...new Set((Array.isArray(value)?value:String(value||'').split(',')).map(x=>String(x).trim().slice(0,40)).filter(Boolean))].slice(0,12)}
'''+s[i:]
s=rep(s,"checklist: cleanChecklist(input.checklist), notes: [],", "dueDate:dueDate(input.dueDate),labels:labels(input.labels),checklist: cleanChecklist(input.checklist), notes: [],")
s=rep(s,"    if (patch.description != null)","    if ('dueDate' in patch) t.dueDate=dueDate(patch.dueDate);\n    if ('labels' in patch) t.labels=labels(patch.labels);\n    if (patch.description != null)")
(R/'src/tasks-store.mjs').write_text(s,encoding='utf8')
s=before('30-tasks.js',BASE/'ru-l10n/features/30-tasks.js')
s=rep(s,"const B={el:null,", "const B={view:LS('oly-tasks-view')||'board',priority:'all',status:'all',sort:'manual',hideDone:false,selected:new Set(),el:null,")
s=rep(s,"function threadId(){const s=location.pathname.split('/').filter(Boolean);", "function threadId(){const s=(location.hash.startsWith('#/')?location.hash.slice(1):location.pathname).split('/').filter(Boolean);")
s=rep(s,"(t.id+' '+t.title+' '+t.description).toLowerCase().includes(q)))", "(t.id+' '+t.title+' '+t.description+' '+(t.labels||[]).join(' ')).toLowerCase().includes(q))&&(B.priority==='all'||t.priority===B.priority)&&(B.status==='all'||t.status===B.status)&&(!B.hideDone||t.status!=='done'))")
s=rep(s,"const list=vis.filter(t=>t.status===s.id).sort((a,b)=>a.order-b.order||a.num-b.num);", "const list=vis.filter(t=>t.status===s.id).sort(taskSort);")
s=rep(s,"for(const s of ST){const list=", "for(const s of ST){if(B.hideDone&&s.id==='done'||B.status!=='all'&&s.id!==B.status)continue;const list=")
s=rep(s,"svg(icon)+'<span>'+esc(label)","(sel.startsWith('p:')?projectIconHtml(projById(sel.slice(2))):svg(icon))+'<span>'+esc(label)")
s=rep(s,"(m?'<span class=\"oly-tk-proj\">'+svg(I.folder)+esc(projTitle(t.projectId))", "(m?'<span class=\"oly-tk-proj\">'+projectIconHtml(projById(t.projectId))+esc(projTitle(t.projectId))")
s=rep(s,"meta+'<div class=\"t\">'", "meta+(t.dueDate?'<span class=\"oly-tk-due '+(t.dueDate<new Date().toLocaleDateString('en-CA')&&t.status!=='done'?'late':'')+'\">'+esc(t.dueDate)+'</span>':'')+(t.labels||[]).map(x=>'<span class=\"oly-tk-label\">'+esc(x)+'</span>').join('')+'<div class=\"t\">'")
s=rep(s,"dlg.querySelector('.oly-tk-body').innerHTML=empty||'<div class=\"oly-tk-board\">'+board+'</div>';", "dlg.querySelector('.oly-tk-body').innerHTML=taskToolbar(vis.length)+(empty||(B.view==='list'?taskList(vis):'<div class=\"oly-tk-board\">'+board+'</div>'));")
s=rep(s,"function bindBoard(root){", "function bindBoard(root){\n bindTaskToolbar(root);")
s=rep(s,"q('[data-f=project]').onchange=e=>patch(id,{projectId:e.target.value});", "q('[data-f=project]').onchange=e=>patch(id,{projectId:e.target.value});\n q('[data-f=due]').onchange=e=>patch(id,{dueDate:e.target.value});\n q('[data-f=labels]').onchange=e=>patch(id,{labels:e.target.value.split(',')});")
s=rep(s,"+'</select></div>'+\n '<div class=\"oly-tk-block\"><h4>Описание", "+'</select>'+\n '<label for=\"oly-tk-due\">Срок</label><input id=\"oly-tk-due\" class=\"oly-tk-input\" type=\"date\" data-f=\"due\" value=\"'+esc(t.dueDate||'')+'\">'+\n '<label for=\"oly-tk-labels\">Метки</label><input id=\"oly-tk-labels\" class=\"oly-tk-input\" data-f=\"labels\" placeholder=\"Через запятую\" value=\"'+esc((t.labels||[]).join(', '))+'\"></div>'+\n '<div class=\"oly-tk-block\"><h4>Описание")
# Extra helpers live in the same feature closure and use its existing API and editor.
i=s.index('function renderBoard(')
s=s[:i]+'''
function projectIconHtml(p){
 if(p?.icon?.kind==='image'&&/^data:image\\//.test(p.icon.url||''))return '<img class="oly-project-icon" alt="" src="'+esc(p.icon.url)+'">';
 if(p?.icon?.kind==='emoji')return '<span class="oly-project-icon">'+esc(p.icon.emoji||p.icon.value||'')+'</span>';
 const label=(p?.title||'П').replace(/[^\\p{L}\\p{N}]/gu,'').slice(0,2).toUpperCase();let hash=0;for(const c of p?.id||'')hash=(hash*31+c.charCodeAt(0))>>>0;
 return '<span class="oly-project-monogram" style="--project-hue:'+hash%360+'">'+esc(label)+'</span>';
}
function taskSort(a,b){if(B.sort==='priority')return PR.findIndex(x=>x.id===a.priority)-PR.findIndex(x=>x.id===b.priority)||a.order-b.order;if(B.sort==='updated')return String(b.updatedAt).localeCompare(String(a.updatedAt));if(B.sort==='due')return String(a.dueDate||'9999').localeCompare(String(b.dueDate||'9999'));return a.order-b.order||a.num-b.num}
function taskToolbar(n){const opts=(arr,v)=>arr.map(x=>'<option value="'+x.id+'"'+(x.id===v?' selected':'')+'>'+esc(x.label)+'</option>').join('');
 return '<div class="oly-tk-toolbar"><div class="oly-tk-view"><button class="oly-tk-btn" data-tv="board" aria-pressed="'+(B.view==='board')+'">Доска</button><button class="oly-tk-btn" data-tv="list" aria-pressed="'+(B.view==='list')+'">Список</button></div>'+ 
 '<select data-tf="status" aria-label="Фильтр статуса">'+opts([{id:'all',label:'Все статусы'},...ST],B.status)+'</select>'+
 '<select data-tf="priority" aria-label="Фильтр приоритета">'+opts([{id:'all',label:'Все приоритеты'},...PR],B.priority)+'</select>'+
 '<select data-tf="sort" aria-label="Сортировка">'+opts([{id:'manual',label:'Мой порядок'},{id:'priority',label:'По приоритету'},{id:'due',label:'По сроку'},{id:'updated',label:'По обновлению'}],B.sort)+'</select>'+
 '<label><input type="checkbox" data-tf="hideDone"'+(B.hideDone?' checked':'')+'> Скрыть готовые</label><span class="oly-tk-total">'+n+' задач</span>'+
 (B.priority!=='all'||B.status!=='all'||B.hideDone||B.q?'<button class="oly-tk-btn ghost" data-reset-filters>Сбросить</button>':'')+'</div>';
}
function taskList(tasks){return '<div class="oly-tk-table">'+(B.adding?addForm():'')+(!tasks.length?'<div class="oly-tk-empty">Задач по этим условиям нет. Добавьте задачу или измените фильтры.</div>':'')+tasks.toSorted(taskSort).map(t=>'<div class="oly-tk-table-row">'+card(t)+'<select data-quick-status="'+esc(t.id)+'" aria-label="Статус '+esc(t.id)+'">'+ST.map(s=>'<option value="'+s.id+'"'+(s.id===t.status?' selected':'')+'>'+s.label+'</option>').join('')+'</select></div>').join('')+'</div>'}
function bindTaskToolbar(root){
 root.querySelectorAll('[data-tv]').forEach(b=>b.onclick=()=>{B.view=b.dataset.tv;LS('oly-tasks-view',B.view);renderBoard()});
 root.querySelectorAll('[data-tf]').forEach(el=>el.onchange=()=>{B[el.dataset.tf]=el.type==='checkbox'?el.checked:el.value;renderBoard()});
 root.querySelectorAll('[data-reset-filters]').forEach(b=>b.onclick=()=>{B.priority='all';B.status='all';B.hideDone=false;B.q='';renderBoard()});
 root.querySelectorAll('[data-quick-status]').forEach(el=>el.onchange=()=>patch(el.dataset.quickStatus,{status:el.value}));
}
'''+s[i:]
s=rep(s,"const css=document.createElement('style');", "const polish=document.createElement('style');polish.textContent=`\n.oly-tk-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 18px;border-bottom:1px solid var(--border);flex:none}.oly-tk-toolbar label{display:flex;align-items:center;gap:6px;color:var(--muted-foreground);font-size:12px}.oly-tk-view{display:flex;gap:2px}.oly-tk-view [aria-pressed=true]{background:var(--accent);border-color:var(--primary)}.oly-tk-total{margin-left:auto;color:var(--muted-foreground);font-size:12px}.oly-tk-table{overflow:auto;padding:14px 18px;min-height:0}.oly-tk-table-row{display:flex;gap:12px;align-items:center;border-bottom:1px solid var(--border);padding:8px 0}.oly-tk-table-row>.oly-tk-card{flex:1;min-width:0;box-shadow:none;border-color:transparent}.oly-tk-table-row>select{flex:none;width:140px}.oly-tk-table .d{-webkit-line-clamp:1}.oly-project-icon{width:22px!important;height:22px!important;object-fit:contain;border-radius:4px;flex:none}.oly-project-monogram{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:5px;background:hsl(var(--project-hue) 35% 88%);color:hsl(var(--project-hue) 55% 28%);font:600 10px/1 system-ui;flex:none!important}.dark .oly-project-monogram{background:hsl(var(--project-hue) 30% 25%);color:hsl(var(--project-hue) 45% 85%)}.oly-tk-item>.oly-project-monogram{flex:none}.oly-tk-due,.oly-tk-label{display:inline-block;padding:1px 5px;margin:0 4px 5px 0;font-size:10px;border:1px solid var(--border);border-radius:4px;color:var(--muted-foreground)}.oly-tk-due.late{color:var(--destructive,#ba2820)}.oly-tk-crumb .sub{display:none}.oly-tk-col{min-width:190px!important}.oly-tk-head{height:auto!important;min-height:56px;flex-wrap:wrap;padding:10px 18px!important;gap:8px}.oly-tk-crumb{flex-basis:180px}.oly-tk-navtitle{font-size:20px!important}.oly-tk-colhead{font:600 12px/1.4 system-ui!important;letter-spacing:.02em!important}.oly-tk-col .oly-tk-list:has(>.oly-tk-addbtn:only-child){min-height:150px}\n@media(max-width:850px){.oly-tk-overlay{padding:12px!important}.oly-tk-nav{width:185px!important}.oly-tk-search input{width:160px!important}}\n`;document.head.append(polish);\nconst css=document.createElement('style');")
(R/'src/30-tasks.js').write_text(s,encoding='utf8')
print('Tasks changes staged')

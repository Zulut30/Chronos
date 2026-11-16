from pathlib import Path
R=Path(__file__).parent;BASE=R.parent
def rep(s,a,b):
 assert s.count(a)==1,(a[:100],s.count(a));return s.replace(a,b)
for name in ['index.html','style.css']:
 p=R/'before'/('skills-'+name)
 if not p.exists():p.write_bytes((BASE/'skills-manager'/name).read_bytes())
s=(R/'before/skills-index.html').read_text('utf8')
s=rep(s,"f.value='';f.placeholder=", "f.placeholder=")
s=rep(s,"function render(){const sc=$('#main').scrollTop;if(view==='overview')renderOverview();else renderLoc();$('#main').scrollTop=sc}","function render(){const sc=$('#main').scrollTop;if(view==='overview'){if(skillMode==='catalog')renderCatalog();else renderOverview()}else renderLoc();$('#main').insertAdjacentHTML('afterbegin',skillToolbar());$('#main').scrollTop=sc}")
s=rep(s,"return !f||(name+' '+(desc||'')).toLowerCase().includes(f)","return !f||f.split(/\\s+/).every(t=>(name+' '+(desc||'')).toLowerCase().includes(t))")
s=rep(s,'const rows=all.filter(e=>match(e.name,e.desc));','const rows=all.filter(e=>match(e.name,e.desc)&&skillPass(e.name,e.cells,e.versions.length));')
s=rep(s,'list=skills.filter(s=>match(s.name,s.description));','list=skills.filter(s=>match(s.name,s.description)&&skillPass(s.name,{[cur.id]:s},index().get(s.name)?.versions.length||0));')
s=rep(s,"loadLocs().then(paint).catch",(R/'skills-polish.js').read_text('utf8')+"\nloadLocs().then(paint).catch")
# Close the embedded manager in one click, including its loading/error state.
s=rep(s,'<span class="grow"></span>\n    <label class="search">','<span class="grow"></span>\n    <button class="btn ghost icon" onclick="parent.postMessage({type:\'oly-skills-close\'},\'t3code://app\')" title="Закрыть" aria-label="Закрыть менеджер">×</button>\n    <label class="search">')
(R/'src/skills-index.html').write_text(s,encoding='utf8')
css=(R/'before/skills-style.css').read_text('utf8')+'''
.skill-toolbar{position:sticky;top:0;z-index:3;display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:10px 20px;background:var(--bg);border-bottom:1px solid var(--border)}.skill-toolbar small{color:var(--muted);font-size:11px}.skill-segments{display:flex;gap:2px}.skill-toolbar [aria-pressed=true]{background:var(--accent);color:var(--primary);border-color:var(--primary)}.skill-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(275px,1fr));gap:12px}.skill-card{background:var(--panel);border:1px solid var(--border);border-radius:9px;padding:14px;display:flex;flex-direction:column;gap:10px;min-width:0}.skill-card:hover{border-color:color-mix(in srgb,var(--primary) 35%,var(--border))}.skill-card header{display:flex;align-items:flex-start;gap:8px}.skill-name{flex:1;min-width:0;text-align:left;overflow-wrap:anywhere;font-weight:600;background:none;border:0;cursor:pointer;padding:0}.skill-card header input{margin-top:4px}.skill-card p{margin:0;color:var(--muted);font-size:12px;line-height:1.6;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;min-height:56px}.skill-card footer{display:flex;gap:4px;margin-top:auto;flex-wrap:wrap}.skill-places{display:flex;flex-wrap:wrap;gap:4px}.skill-places button{cursor:pointer}.favorite[aria-pressed=true]{color:var(--primary)}.skill-catalog .head h2 small{font:12px system-ui;color:var(--muted)}.top{height:auto;min-height:52px;flex-wrap:wrap;padding:8px 12px}.app{grid-template-rows:auto minmax(0,1fr)}.top .search{flex:1;max-width:380px;min-width:160px}.top .search input{width:100%}.content{padding-top:16px}.matrix thead{position:sticky;top:0;background:var(--panel)}.dialog{max-height:calc(100vh - 32px)}
@media(max-width:850px){.app{grid-template-columns:180px 1fr}.skill-toolbar{padding:8px 12px}.content{padding:12px}.skill-grid{grid-template-columns:1fr}.skill-toolbar small{display:none}}
'''
(R/'src/skills-style.css').write_text(css,encoding='utf8')
# Extend agent-visible task fields alongside the HTTP editor.
p=R/'before/tasks-mcp.mjs'
if not p.exists():p.write_bytes((BASE/'tasks-service/mcp.mjs').read_bytes())
s=p.read_text('utf8')
s=s.replace("priority: { type: 'string', enum: PRIORITY_ENUM }", "dueDate:{type:'string',description:'Срок YYYY-MM-DD, пустая строка снимает срок'},labels:{type:'array',items:{type:'string'},description:'Метки задачи'},priority: { type: 'string', enum: PRIORITY_ENUM }")
s=rep(s,'title: a.title, description: a.description, priority: a.priority, status:', 'title: a.title, description: a.description, dueDate:a.dueDate,labels:a.labels,priority: a.priority, status:')
s=rep(s,'title: a.title, description: a.description, priority: a.priority, check:', "title: a.title, description: a.description, ...('dueDate'in a?{dueDate:a.dueDate}:{}),...('labels'in a?{labels:a.labels}:{}),priority: a.priority, check:")
(R/'src/tasks-mcp.mjs').write_text(s,encoding='utf8')
print('Skills and task agent tools staged')

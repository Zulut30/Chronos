async function productivityCheck(tasksSource,skillsHtml,skillsCss){
 const results=[];const ok=(name,v)=>{results.push({name,pass:!!v});if(!v)throw Error(name)};const pause=()=>new Promise(r=>setTimeout(r,150));
 const frame=document.createElement('iframe');frame.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:9999;background:white';document.body.append(frame);const w=frame.contentWindow,d=w.document;
 w.requestAnimationFrame=fn=>w.setTimeout(fn,5);w.cancelAnimationFrame=w.clearTimeout.bind(w);
 const projects=[{id:'project-1',title:'Project',root:'C:/mock',icon:{kind:'image',url:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="blue"/></svg>'}}];
 const tasks=[{id:'T-1',num:1,title:'Fix bug',projectId:'project-1',status:'doing',priority:'high',description:'Example task',checklist:[],notes:[],labels:['UI'],dueDate:'2026-11-20',order:1024,updatedAt:'2026-11-16T00:00:00Z'},{id:'T-2',num:2,title:'Done task',projectId:'project-1',status:'done',priority:'low',description:'',checklist:[],notes:[],order:1024,updatedAt:'2026-11-16T00:00:00Z'}];
 w.fetch=async(url,opts={})=>{let body;if(url.endsWith('/projects'))body=projects;else if(url.endsWith('/groups'))body=[];else if(url.endsWith('/tasks'))body=tasks;else if(url.includes('/thread/'))body={projectId:'project-1'};else if(opts.method==='PATCH'){let t=tasks.find(t=>url.endsWith(t.id));Object.assign(t,JSON.parse(opts.body));body=t}else body={};return {ok:true,json:async()=>body}};
 d.open();d.write('<!doctype html><html><head><style>:root{--background:#f3efe6;--foreground:#0e1116;--muted-foreground:#5b5f68;--border:#d6cfbf;--card:#fffdf8;--primary:#1952c5;--primary-foreground:#fff;--accent:#e8e1d2;--radius:8px}</style></head><body></body></html>');d.close();w.location.hash='/environment/7a578a34-2668-47ea-b623-11e681d080b9';w.eval(tasksSource);await w.__olyTasks.open();await pause();
 ok('tasks_native_project_icon',d.querySelector('.oly-tk-item .oly-project-icon'));
 d.querySelector('[data-tv=list]').click();ok('tasks_list_view',d.querySelectorAll('.oly-tk-table-row').length===2);
 let filter=d.querySelector('[data-tf=priority]');filter.value='high';filter.dispatchEvent(new w.Event('change'));ok('tasks_priority_filter',d.querySelectorAll('.oly-tk-table-row').length===1);
 d.querySelector('.oly-tk-card').click();await pause();ok('tasks_detail_deadline_and_labels',d.querySelector('[data-f=due]').value==='2026-11-20'&&d.querySelector('[data-f=labels]').value==='UI');
 const due=d.querySelector('[data-f=due]');due.value='2026-11-24';due.dispatchEvent(new w.Event('change'));await pause();ok('tasks_deadline_save',tasks[0].dueDate==='2026-11-24');
 w.__olyTasks.close();frame.remove();
 const f=document.createElement('iframe');f.style.cssText=frame.style.cssText;document.body.append(f);const sw=f.contentWindow,sd=sw.document;
 sw.requestAnimationFrame=fn=>sw.setTimeout(fn,5);sw.cancelAnimationFrame=sw.clearTimeout.bind(sw);
 const locs=[{id:'codex-local',agent:'codex',short:'Codex',label:'Codex',kind:'local',group:'Компьютер',exists:true,path:'mock'},{id:'claude-local',agent:'claude',short:'Claude',label:'Claude',kind:'local',group:'Компьютер',exists:true,path:'mock2'}];
 sw.fetch=async url=>({ok:true,json:async()=>url.startsWith('/api/locations')?locs:url.startsWith('/api/skills')?{exists:true,skills:[{name:'alpha',description:'Helpful research skill',disabled:false,mtime:100},{name:'beta',description:'Disabled editor skill',disabled:true,mtime:200}]}:url.startsWith('/api/hashes')?{alpha:'abc','!beta':'def'}:{}});
 const script=skillsHtml.slice(skillsHtml.indexOf('<script>')+8,skillsHtml.indexOf('</script>'));
 sd.open();sd.write(skillsHtml.slice(0,skillsHtml.indexOf('<script>')).replace('<link rel="stylesheet" href="style.css">','<style>'+skillsCss+'</style>')+'</body></html>');sd.close();sw.localStorage.setItem('oly-skills-layout-v3',JSON.stringify('catalog'));sw.localStorage.setItem('oly-skills-favorites','[]');sw.eval(script);await pause();await pause();
 ok('skills_catalog_default',sd.querySelectorAll('.skill-card').length===2);
 sd.querySelector('[data-favorite=alpha]').click();sd.querySelector('[data-favonly]').click();ok('skills_favorites_filter',sd.querySelectorAll('.skill-card').length===1&&sd.querySelector('.skill-name').textContent==='alpha');
 sd.querySelector('[data-favonly]').click();const state=sd.querySelector('[data-skill-filter=state]');state.value='disabled';state.dispatchEvent(new sw.Event('change',{bubbles:true}));ok('skills_disabled_filter',sd.querySelectorAll('.skill-card').length===1&&sd.querySelector('.skill-name').textContent==='beta');
 sd.querySelector('[data-layout=matrix]').click();ok('skills_matrix_preserved',sd.querySelector('.matrix'));
 sd.querySelector('[data-view=codex-local]').click();await pause();ok('skills_location_keeps_filters',sd.querySelectorAll('.row').length===1&&sd.querySelector('.row').textContent.includes('beta'));
 f.remove();return results;
}

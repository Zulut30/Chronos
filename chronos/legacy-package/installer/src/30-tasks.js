;(()=>{try{
/* Olympus tasks: Trello-like board per T3 project (sidebar «Задачи» → in-app dialog) + «#» task mentions in the composer.
   Data lives in the local service tasks-service (127.0.0.1:4518); agents use the same data through its MCP server. */
const API='http://127.0.0.1:4518/api/';
const LS=(k,v)=>{try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){return null}};
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ST=[{id:'backlog',label:'Бэклог'},{id:'doing',label:'В работе'},{id:'review',label:'На проверке'},{id:'done',label:'Готово'}];
const PR=[{id:'urgent',label:'Срочно'},{id:'high',label:'Высокий'},{id:'normal',label:'Обычный'},{id:'low',label:'Низкий'}];
const stLabel=s=>(ST.find(x=>x.id===s)||{label:s}).label, prLabel=p=>(PR.find(x=>x.id===p)||{label:p}).label;
const svg=(d,cls)=>'<svg class="'+(cls||'')+'" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+d+'</svg>';
const I={
 board:'<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M8 7v7"/><path d="M12 7v4"/><path d="M16 7v9"/>',
 x:'<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',plus:'<path d="M5 12h14"/><path d="M12 5v14"/>',
 list:'<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
 note:'<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',folder:'<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
 group:'<path d="M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v1"/><path d="M2 13h20v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z"/>',
 all:'<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
 send:'<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',trash:'<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
 pen:'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',search:'<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
 hash:'<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>'};

const polish=document.createElement('style');polish.textContent=`
.oly-tk-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 18px;border-bottom:1px solid var(--border);flex:none}.oly-tk-toolbar label{display:flex;align-items:center;gap:6px;color:var(--muted-foreground);font-size:12px}.oly-tk-view{display:flex;gap:2px}.oly-tk-view [aria-pressed=true]{background:var(--accent);border-color:var(--primary)}.oly-tk-total{margin-left:auto;color:var(--muted-foreground);font-size:12px}.oly-tk-table{overflow:auto;padding:14px 18px;min-height:0}.oly-tk-table-row{display:flex;gap:12px;align-items:center;border-bottom:1px solid var(--border);padding:8px 0}.oly-tk-table-row>.oly-tk-card{flex:1;min-width:0;box-shadow:none;border-color:transparent}.oly-tk-table-row>select{flex:none;width:140px}.oly-tk-table .d{-webkit-line-clamp:1}.oly-project-icon{width:22px!important;height:22px!important;object-fit:contain;border-radius:4px;flex:none}.oly-project-monogram{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:5px;background:hsl(var(--project-hue) 35% 88%);color:hsl(var(--project-hue) 55% 28%);font:600 10px/1 system-ui;flex:none!important}.dark .oly-project-monogram{background:hsl(var(--project-hue) 30% 25%);color:hsl(var(--project-hue) 45% 85%)}.oly-tk-item>.oly-project-monogram{flex:none}.oly-tk-due,.oly-tk-label{display:inline-block;padding:1px 5px;margin:0 4px 5px 0;font-size:10px;border:1px solid var(--border);border-radius:4px;color:var(--muted-foreground)}.oly-tk-due.late{color:var(--destructive,#ba2820)}.oly-tk-crumb .sub{display:none}.oly-tk-col{min-width:190px!important}.oly-tk-head{height:auto!important;min-height:56px;flex-wrap:wrap;padding:10px 18px!important;gap:8px}.oly-tk-crumb{flex-basis:180px}.oly-tk-navtitle{font-size:20px!important}.oly-tk-colhead{font:600 12px/1.4 system-ui!important;letter-spacing:.02em!important}.oly-tk-col .oly-tk-list:has(>.oly-tk-addbtn:only-child){min-height:150px}
@media(max-width:850px){.oly-tk-overlay{padding:12px!important}.oly-tk-nav{width:185px!important}.oly-tk-search input{width:160px!important}}
`;document.head.append(polish);
const css=document.createElement('style');css.id='oly-tasks-css';
css.textContent=`
.oly-tk-row{display:flex;align-items:center;gap:8px;width:100%;margin-top:2px;border:0;background:transparent;font:inherit;text-align:left;cursor:pointer}
.oly-tk-row svg{width:16px;height:16px;flex-shrink:0}
.oly-tk-row .oly-tk-rowcount{margin-left:auto;font-size:12px;font-weight:400;font-variant-numeric:tabular-nums;opacity:.8}
.oly-tk-overlay{position:fixed;inset:0;z-index:9000;background:color-mix(in srgb,#000 38%,transparent);display:flex;align-items:center;justify-content:center;padding:32px}
.oly-tk-dialog{position:relative;width:min(1320px,100%);height:min(860px,100%);background:var(--background);color:var(--foreground);border:1px solid var(--border);border-radius:var(--radius,10px);box-shadow:0 24px 70px #0006;overflow:hidden;display:flex;font-size:13px;line-height:1.45}
.oly-tk-dialog{font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}.oly-tk-dialog *{box-sizing:border-box}
.oly-tk-dialog button,.oly-tk-dialog input,.oly-tk-dialog select,.oly-tk-dialog textarea{font:inherit;color:inherit}
.oly-tk-nav{width:240px;flex-shrink:0;border-right:1px solid var(--border);display:flex;flex-direction:column;background:color-mix(in srgb,var(--foreground) 2.5%,var(--background));overflow-y:auto;padding:14px 10px}
.oly-tk-navtitle{font-size:15px;font-weight:600;padding:2px 8px 12px;display:flex;align-items:center;gap:8px}
.oly-tk-navtitle svg{width:16px;height:16px;color:var(--muted-foreground)}
.oly-tk-sec{display:flex;align-items:center;justify-content:space-between;font-size:12px;font-weight:500;color:var(--muted-foreground);padding:14px 8px 4px}
.oly-tk-item{display:flex;align-items:center;gap:8px;width:100%;height:30px;padding:0 8px;border:0;border-radius:var(--control-radius,6px);background:transparent;cursor:pointer;text-align:left;color:var(--muted-foreground)}
.oly-tk-item:hover{background:var(--accent);color:var(--foreground)}
.oly-tk-item[aria-current=true]{background:var(--accent);color:var(--foreground);font-weight:500}
.oly-tk-item svg{width:15px;height:15px;flex-shrink:0;opacity:.8}
.oly-tk-item span{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.oly-tk-item small{font-size:12px;font-variant-numeric:tabular-nums;color:var(--muted-foreground);font-weight:400}
.oly-tk-item .here{width:6px;height:6px;border-radius:50%;background:var(--primary);flex-shrink:0}
.oly-tk-navfoot{margin-top:auto;padding:14px 8px 2px;font-size:12px;color:var(--muted-foreground)}
.oly-tk-navfoot label{display:flex;gap:8px;align-items:flex-start;cursor:pointer;line-height:1.35}
.oly-tk-navfoot input{margin-top:2px}
.oly-tk-main{flex:1;min-width:0;display:flex;flex-direction:column;position:relative}
.oly-tk-head{display:flex;align-items:center;gap:8px;height:56px;padding:0 14px 0 20px;border-bottom:1px solid var(--border);flex-shrink:0}
.oly-tk-crumb{display:flex;align-items:baseline;gap:8px;min-width:0;flex:1;font-size:14px}
.oly-tk-crumb .m{color:var(--muted-foreground)}
.oly-tk-crumb h2{margin:0;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.oly-tk-crumb .sub{color:var(--muted-foreground);font-size:12px;white-space:nowrap}
.oly-tk-search{position:relative;display:flex;align-items:center}
.oly-tk-search svg{position:absolute;left:8px;width:14px;height:14px;color:var(--muted-foreground);pointer-events:none}
.oly-tk-search input{padding-left:28px;width:200px}
.oly-tk-input,.oly-tk-dialog select,.oly-tk-dialog textarea{height:28px;padding:0 8px;border:1px solid var(--border);border-radius:var(--control-radius,6px);background:transparent;outline:none;min-width:0}
.oly-tk-dialog select{padding-right:4px;cursor:pointer;background:var(--background)}
.oly-tk-dialog textarea{height:auto;padding:8px;resize:vertical;line-height:1.5;width:100%}
.oly-tk-input:focus,.oly-tk-dialog select:focus,.oly-tk-dialog textarea:focus{border-color:color-mix(in srgb,var(--primary) 60%,var(--border));box-shadow:0 0 0 2px color-mix(in srgb,var(--primary) 18%,transparent)}
.oly-tk-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:28px;padding:0 10px;border:1px solid var(--border);border-radius:var(--control-radius,6px);background:transparent;cursor:pointer;white-space:nowrap;font-weight:500}
.oly-tk-btn:hover{background:var(--accent)}
.oly-tk-btn svg{width:14px;height:14px}
.oly-tk-btn.primary{background:var(--primary);color:var(--primary-foreground);border-color:transparent}
.oly-tk-btn.primary:hover{background:color-mix(in srgb,var(--primary) 88%,var(--foreground))}
.oly-tk-btn.ghost{border-color:transparent}
.oly-tk-btn.danger{color:#dc2626}
.oly-tk-btn.danger.armed{background:#dc2626;color:#fff;border-color:transparent}
.oly-tk-btn:disabled{opacity:.5;cursor:default}
.oly-tk-ico{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:var(--control-radius,6px);background:transparent;color:var(--muted-foreground);cursor:pointer;flex-shrink:0}
.oly-tk-ico:hover{background:var(--accent);color:var(--foreground)}
.oly-tk-ico svg{width:15px;height:15px}
.oly-tk-ico.sm{width:22px;height:22px}.oly-tk-ico.sm svg{width:13px;height:13px}
.oly-tk-dialog :focus-visible{outline:2px solid color-mix(in srgb,var(--primary) 70%,transparent);outline-offset:1px}
.oly-tk-body{flex:1;min-height:0;display:flex;flex-direction:column}
.oly-tk-board{flex:1;min-height:0;display:flex;gap:12px;padding:16px 20px 20px;overflow-x:auto}
.oly-tk-col{flex:1 1 0;min-width:250px;display:flex;flex-direction:column;border-radius:var(--radius,8px);background:color-mix(in srgb,var(--foreground) 3.5%,transparent);border:1px solid color-mix(in srgb,var(--border) 70%,transparent)}
.oly-tk-colhead{display:flex;align-items:center;gap:8px;height:40px;padding:0 6px 0 12px;font-weight:500;flex-shrink:0}
.oly-tk-colhead small{color:var(--muted-foreground);font-weight:400;font-variant-numeric:tabular-nums}
.oly-tk-colhead .sp{flex:1}
.oly-tk-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;background:#8B93A1}
.oly-tk-dot[data-s=doing]{background:#3B82F6}.oly-tk-dot[data-s=review]{background:#D97706}.oly-tk-dot[data-s=done]{background:#16A34A}
.oly-tk-list{flex:1;min-height:60px;overflow-y:auto;padding:2px 8px 10px;display:flex;flex-direction:column;gap:8px}
.oly-tk-list.over{background:color-mix(in srgb,var(--primary) 5%,transparent)}
.oly-tk-drop{height:3px;border-radius:2px;background:var(--primary);flex-shrink:0;margin:-2px 0}
.oly-tk-card{position:relative;display:block;width:100%;padding:9px 11px 10px;border:1px solid var(--border);border-radius:var(--radius,8px);background:var(--card,var(--background));color:var(--card-foreground,var(--foreground));cursor:pointer;text-align:left;box-shadow:0 1px 2px #0000000d;flex-shrink:0}
.oly-tk-card:hover{border-color:color-mix(in srgb,var(--foreground) 22%,var(--border))}
.oly-tk-card[aria-selected=true]{border-color:color-mix(in srgb,var(--primary) 70%,var(--border));box-shadow:0 0 0 1px color-mix(in srgb,var(--primary) 40%,transparent)}
.oly-tk-card.dragging{opacity:.4}
.oly-tk-card .t{font-weight:500;font-size:13px;line-height:1.4;word-break:break-word}
.oly-tk-card .d{margin-top:3px;color:var(--muted-foreground);font-size:12px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.oly-tk-meta{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;margin-bottom:4px;font-size:11.5px;color:var(--muted-foreground)}
.oly-tk-meta .id{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px}
.oly-tk-meta .ic{display:inline-flex;align-items:center;gap:3px}
.oly-tk-meta svg{width:12px;height:12px}
.oly-tk-foot{display:flex;align-items:center;gap:10px;margin-top:7px;font-size:11.5px;color:var(--muted-foreground)}
.oly-tk-foot:empty{display:none}
.oly-tk-foot .ic{display:inline-flex;align-items:center;gap:3px}.oly-tk-foot svg{width:12px;height:12px}
.oly-tk-foot .ok{color:#16A34A}
.oly-tk-pr{display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:999px;font-size:11px;font-weight:500;background:color-mix(in srgb,var(--foreground) 7%,transparent);color:var(--muted-foreground)}
.oly-tk-pr[data-p=urgent]{background:color-mix(in srgb,#DC2626 14%,transparent);color:#DC2626}
.oly-tk-pr[data-p=high]{background:color-mix(in srgb,#EA580C 14%,transparent);color:#C2410C}
.dark .oly-tk-pr[data-p=high]{color:#FB923C}.dark .oly-tk-pr[data-p=urgent]{color:#F87171}
.oly-tk-proj{display:inline-flex;align-items:center;gap:4px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.oly-tk-proj svg{flex-shrink:0}
.oly-tk-add{display:flex;flex-direction:column;gap:6px;padding:8px;border:1px dashed var(--border);border-radius:var(--radius,8px);flex-shrink:0}
.oly-tk-add .row{display:flex;gap:6px}.oly-tk-add .row>*{flex:1}
.oly-tk-addbtn{display:flex;align-items:center;gap:6px;height:30px;padding:0 8px;border:0;border-radius:var(--control-radius,6px);background:transparent;color:var(--muted-foreground);cursor:pointer;flex-shrink:0}
.oly-tk-addbtn:hover{background:var(--accent);color:var(--foreground)}.oly-tk-addbtn svg{width:14px;height:14px}
.oly-tk-empty{margin:auto;max-width:440px;text-align:center;color:var(--muted-foreground);line-height:1.55;padding:24px}
.oly-tk-empty code{font-family:ui-monospace,Consolas,monospace;color:var(--foreground)}
.oly-tk-detail{position:absolute;top:0;right:0;bottom:0;width:min(470px,100%);background:var(--background);border-left:1px solid var(--border);box-shadow:-16px 0 40px -24px #0006;display:flex;flex-direction:column;z-index:3}
.oly-tk-dhead{display:flex;align-items:center;gap:8px;height:56px;padding:0 10px 0 20px;border-bottom:1px solid var(--border);flex-shrink:0}
.oly-tk-dhead .id{font-family:ui-monospace,Consolas,monospace;color:var(--muted-foreground);font-size:12px}
.oly-tk-dhead .sv{flex:1;font-size:12px;color:var(--muted-foreground);text-align:right}
.oly-tk-dbody{flex:1;overflow-y:auto;padding:16px 20px 24px;display:flex;flex-direction:column;gap:16px}
.oly-tk-dialog .oly-tk-title{width:100%;height:auto;border:1px solid transparent;border-radius:var(--control-radius,6px);background:transparent;font-size:17px;font-weight:600;padding:4px 6px;margin:-4px -6px;outline:none;resize:none;overflow:hidden;line-height:1.35}
.oly-tk-dialog .oly-tk-title:hover{border-color:var(--border)}
.oly-tk-dialog .oly-tk-title:focus{box-shadow:none;border-color:color-mix(in srgb,var(--primary) 60%,var(--border))}
.oly-tk-fields{display:grid;grid-template-columns:96px 1fr;gap:8px 12px;align-items:center}
.oly-tk-fields label{color:var(--muted-foreground)}
.oly-tk-fields select{width:100%}
.oly-tk-block h4{display:flex;align-items:center;gap:8px;margin:0 0 6px;font-size:12px;font-weight:500;color:var(--muted-foreground)}
.oly-tk-block h4 .sp{flex:1}
.oly-tk-tabs{display:inline-flex;gap:2px}
.oly-tk-tabs button{height:22px;padding:0 8px;border:0;border-radius:var(--control-radius,6px);background:transparent;color:var(--muted-foreground);cursor:pointer;font-size:12px}
.oly-tk-tabs button[aria-pressed=true]{background:var(--accent);color:var(--foreground)}
.oly-tk-md{min-height:60px;padding:8px 10px;border:1px solid var(--border);border-radius:var(--control-radius,6px);line-height:1.55;overflow-wrap:anywhere}
.oly-tk-md>:first-child{margin-top:0}.oly-tk-md>:last-child{margin-bottom:0}
.oly-tk-md h1,.oly-tk-md h2,.oly-tk-md h3{font-size:14px;margin:10px 0 4px}
.oly-tk-md p,.oly-tk-md ul,.oly-tk-md ol,.oly-tk-md pre{margin:4px 0}
.oly-tk-md ul,.oly-tk-md ol{padding-left:20px}.oly-tk-md ul{list-style:disc}.oly-tk-md ol{list-style:decimal}.oly-tk-md li.task{list-style:none;margin-left:-16px}
.oly-tk-md code{font-family:ui-monospace,Consolas,monospace;font-size:12px;padding:1px 4px;border-radius:4px;background:color-mix(in srgb,var(--foreground) 8%,transparent)}
.oly-tk-md pre{padding:8px;border-radius:6px;background:color-mix(in srgb,var(--foreground) 6%,transparent);overflow-x:auto}
.oly-tk-md pre code{padding:0;background:none}
.oly-tk-md a{color:var(--primary)}
.oly-tk-md .muted{color:var(--muted-foreground)}
.oly-tk-cl{display:flex;flex-direction:column;gap:2px}
.oly-tk-ci{display:flex;align-items:center;gap:8px;min-height:28px}
.oly-tk-ci input[type=checkbox]{width:15px;height:15px;flex-shrink:0;accent-color:var(--primary);cursor:pointer}
.oly-tk-ci .txt{flex:1;border:1px solid transparent;border-radius:var(--control-radius,6px);background:transparent;height:26px;padding:0 6px;outline:none;min-width:0}
.oly-tk-ci .txt:hover{border-color:var(--border)}.oly-tk-ci .txt:focus{border-color:color-mix(in srgb,var(--primary) 60%,var(--border))}
.oly-tk-ci.done .txt{text-decoration:line-through;color:var(--muted-foreground)}
.oly-tk-ci .oly-tk-ico{opacity:0}.oly-tk-ci:hover .oly-tk-ico,.oly-tk-ci .oly-tk-ico:focus-visible{opacity:1}
.oly-tk-prog{height:4px;border-radius:2px;background:color-mix(in srgb,var(--foreground) 10%,transparent);overflow:hidden;margin-bottom:6px}
.oly-tk-prog i{display:block;height:100%;background:#16A34A}
.oly-tk-notes{display:flex;flex-direction:column;gap:8px}
.oly-tk-n{padding:8px 10px;border-radius:var(--control-radius,6px);background:color-mix(in srgb,var(--foreground) 4%,transparent)}
.oly-tk-n .w{font-size:11.5px;color:var(--muted-foreground);margin-bottom:2px}
.oly-tk-n .w b{font-weight:500;color:var(--foreground)}
.oly-tk-n .x{white-space:pre-wrap;overflow-wrap:anywhere}
.oly-tk-addnote{display:flex;gap:6px;align-items:flex-end}
.oly-tk-dfoot{display:flex;align-items:center;gap:8px;padding:12px 20px;border-top:1px solid var(--border);flex-shrink:0}
.oly-tk-dfoot .sp{flex:1}
.oly-tk-dfoot .info{font-size:11.5px;color:var(--muted-foreground)}
.oly-tk-modal{position:absolute;inset:0;z-index:5;background:color-mix(in srgb,#000 25%,transparent);display:flex;align-items:center;justify-content:center}
.oly-tk-mbox{width:min(440px,92%);max-height:86%;display:flex;flex-direction:column;background:var(--background);border:1px solid var(--border);border-radius:var(--radius,10px);box-shadow:0 18px 50px #0005}
.oly-tk-mbox h3{margin:0;padding:16px 20px 4px;font-size:15px;font-weight:600}
.oly-tk-mbox p{margin:0;padding:0 20px 12px;color:var(--muted-foreground);font-size:12.5px}
.oly-tk-mbody{padding:3px 20px 0;overflow-y:auto;display:flex;flex-direction:column;gap:10px}
.oly-tk-checks{display:flex;flex-direction:column;gap:2px;border:1px solid var(--border);border-radius:var(--control-radius,6px);padding:6px;max-height:300px;overflow-y:auto}
.oly-tk-checks label{display:flex;align-items:center;gap:8px;min-height:28px;padding:0 6px;border-radius:4px;cursor:pointer}
.oly-tk-checks label:hover{background:var(--accent)}
.oly-tk-checks small{margin-left:auto;color:var(--muted-foreground);max-width:50%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}
.oly-tk-mfoot{display:flex;gap:8px;padding:16px 20px}.oly-tk-mfoot .sp{flex:1}
.oly-tk-err{color:#DC2626;font-size:12px}
.oly-tk-pop{position:fixed;z-index:60;display:flex;flex-direction:column;max-height:300px;background:var(--popover,var(--background));color:var(--popover-foreground,var(--foreground));border:1px solid var(--border);border-radius:var(--radius,10px);box-shadow:0 12px 32px -12px #0006,0 2px 6px #0000001a;font-size:13px;overflow:hidden}
.oly-tk-pophead{display:flex;align-items:center;gap:6px;padding:8px 12px 6px;font-size:11.5px;color:var(--muted-foreground);border-bottom:1px solid var(--border)}
.oly-tk-pophead svg{width:13px;height:13px}
.oly-tk-pophead .sp{flex:1}
.oly-tk-pophead kbd{font:inherit;font-size:10.5px;padding:0 4px;border:1px solid var(--border);border-radius:4px}
.oly-tk-poplist{overflow-y:auto;padding:6px}
.oly-tk-popg{padding:6px 8px 2px;font-size:11px;font-weight:500;color:var(--muted-foreground)}
.oly-tk-opt{display:flex;align-items:center;gap:8px;min-height:30px;padding:3px 8px;border-radius:calc(var(--radius,10px) - 4px);cursor:pointer}
.oly-tk-opt[aria-selected=true]{background:var(--accent);color:var(--accent-foreground,var(--foreground))}
.oly-tk-opt .id{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;color:var(--muted-foreground);flex-shrink:0;min-width:40px}
.oly-tk-opt .tt{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.oly-tk-opt .tt small{color:var(--muted-foreground);margin-left:6px}
.oly-tk-opt .st{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--muted-foreground);flex-shrink:0}
.oly-tk-opt .oly-tk-dot{width:7px;height:7px}
.oly-tk-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9500;padding:8px 14px;border-radius:var(--radius,8px);background:var(--foreground);color:var(--background);font-size:13px;box-shadow:0 8px 24px #0004}
`;
const addCss=()=>{const p=document.head||document.documentElement;if(p&&!css.isConnected)p.appendChild(css);return !!p};
if(!addCss())document.addEventListener('readystatechange',addCss,{once:true});

/* ---------------- service ---------------- */
async function api(method,path,body){
 const ctl=new AbortController();const tm=setTimeout(()=>ctl.abort(),6000);
 try{const r=await fetch(API+path,{method,signal:ctl.signal,cache:'no-store',headers:method==='GET'?{}:{'x-oly':'1','content-type':'application/json'},body:body?JSON.stringify(body):undefined});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||('HTTP '+r.status));return j}
 finally{clearTimeout(tm)}}
const S={projects:[],groups:[],tasks:[],loadedAt:0,up:null};
async function loadAll(){try{const[p,g,t]=await Promise.all([api('GET','projects'),api('GET','groups'),api('GET','tasks')]);S.projects=p;S.groups=g;S.tasks=t;S.loadedAt=Date.now();S.up=true}catch(e){S.up=false;throw e}}
async function fresh(maxAge){if(Date.now()-S.loadedAt>maxAge)await loadAll()}
const projById=id=>S.projects.find(p=>p.id===id);
const projTitle=id=>(projById(id)||{title:'Проект'}).title;
function upsert(t){const i=S.tasks.findIndex(x=>x.id===t.id);if(i>=0)S.tasks[i]=t;else S.tasks.push(t)}

/* current thread → project */
const threadProj=new Map();
function threadId(){const s=(location.hash.startsWith('#/')?location.hash.slice(1):location.pathname).split('/').filter(Boolean);if(s.length<2||s[0]==='draft')return null;const last=s[s.length-1];return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(last)?last:null}
async function currentProject(){const id=threadId();if(!id)return null;if(threadProj.has(id))return threadProj.get(id);
 try{const r=await api('GET','thread/'+encodeURIComponent(id));threadProj.set(id,r.projectId||null);return r.projectId||null}catch(e){return null}}
function knownCurrentProject(){const id=threadId();return id?threadProj.get(id)||null:null}

/* ---------------- tiny markdown ---------------- */
function inline(s){return esc(s).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g,'$1<i>$2</i>')
 .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')}
function md(src){const L=String(src||'').replace(/\r\n/g,'\n').split('\n');let h='',list=null,code=null,para=[];
 const flushP=()=>{if(para.length){h+='<p>'+para.map(inline).join('<br>')+'</p>';para=[]}};
 const closeL=()=>{if(list){h+='</'+list+'>';list=null}};
 for(const line of L){
  if(code!==null){if(/^```/.test(line)){h+='<pre><code>'+esc(code)+'</code></pre>';code=null}else code+=(code?'\n':'')+line;continue}
  if(/^```/.test(line)){flushP();closeL();code='';continue}
  let m;
  if((m=/^(#{1,6})\s+(.*)$/.exec(line))){flushP();closeL();const n=Math.min(3,m[1].length);h+='<h'+n+'>'+inline(m[2])+'</h'+n+'>';continue}
  if((m=/^\s*[-*+]\s+(.*)$/.exec(line))){flushP();if(list!=='ul'){closeL();h+='<ul>';list='ul'}const tm=/^\[([ xX])\]\s+(.*)$/.exec(m[1]);
   h+='<li'+(tm?' class="task"':'')+'>'+(tm?(tm[1]===' '?'☐ ':'☑ ')+(tm[1]===' '?inline(tm[2]):'<span class="muted">'+inline(tm[2])+'</span>'):inline(m[1]))+'</li>';continue}
  if((m=/^\s*\d+[.)]\s+(.*)$/.exec(line))){flushP();if(list!=='ol'){closeL();h+='<ol>';list='ol'}h+='<li>'+inline(m[1])+'</li>';continue}
  if(!line.trim()){flushP();closeL();continue}
  closeL();para.push(line)}
 if(code!==null)h+='<pre><code>'+esc(code)+'</code></pre>';flushP();closeL();return h||'<p class="muted">Нет описания</p>'}
const plain=s=>String(s||'').replace(/```[\s\S]*?```/g,' ').replace(/[#*`>_]|\[( |x)\]/g,'').replace(/\s+/g,' ').trim();
function ago(iso){const d=(Date.now()-Date.parse(iso))/1000;if(!(d>=0))return'';if(d<60)return'только что';if(d<3600)return Math.floor(d/60)+' мин';if(d<86400)return Math.floor(d/3600)+' ч';if(d<86400*30)return Math.floor(d/86400)+' д';return new Date(iso).toLocaleDateString('ru-RU')}
function toast(msg){const t=document.createElement('div');t.className='oly-tk-toast';t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),2600)}

/* ---------------- composer insertion ---------------- */
function refText(t){if(LS('oly-tasks-autostart')!=='0'&&t.status==='backlog')t={...t,status:'doing'};
 const parts=['проект '+projTitle(t.projectId)];if(t.priority!=='normal')parts.push('приоритет: '+prLabel(t.priority).toLowerCase());parts.push('статус: '+stLabel(t.status));
 let s='#'+t.id+' «'+t.title+'» ('+parts.join(', ')+')';
 const d=String(t.description||'').trim();if(d)s+='\n'+d;
 if(t.checklist&&t.checklist.length)s+='\nЧек-лист:\n'+t.checklist.map(c=>'- ['+(c.done?'x':' ')+'] '+c.text).join('\n');
 s+='\n(Задача с доски «Задачи» T3: прочитать и обновить — MCP oly-tasks, get_task / update_task.)\n';return s}
function composerEditor(){return document.querySelector('[data-slot=composer-host] .composer-tiptap')}
function insertAtEnd(t){const ed=composerEditor();if(!ed)return false;ed.focus();const sel=getSelection();sel.selectAllChildren(ed);sel.collapseToEnd();
 const empty=!ed.textContent.trim();document.execCommand('insertText',false,(empty?'':'\n')+refText(t));return true}
async function markStarted(t){if(LS('oly-tasks-autostart')==='0'||t.status!=='backlog')return;
 try{upsert(await api('PATCH','tasks/'+t.id,{status:'doing',note:'Взята в работу: задачу упомянули в чате',by:'T3'}));refreshCount()}catch(e){}}

/* ---------------- sidebar entry ---------------- */
let rowCountTimer=0;
function ensureRow(){
 const search=document.querySelector('[data-slot=sidebar] input[type=search]');if(!search)return;
 const row=search.closest('[data-slot=sidebar-group] > div');if(!row||!row.parentElement)return;
 let b=row.parentElement.querySelector(':scope > .oly-tk-row');
 if(b){if(b.previousElementSibling!==row)row.after(b);return}
 b=document.createElement('button');b.type='button';
 b.className='oly-tk-row flex h-8 min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground';
 b.setAttribute('data-oly-tasks','');b.setAttribute('aria-label','Задачи');b.title='Доска задач по проектам';
 b.innerHTML=svg(I.board)+'<span>Задачи</span><span class="oly-tk-rowcount"></span>';
 b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();openBoard()});
 row.after(b);refreshCount()}
async function refreshCount(){clearTimeout(rowCountTimer);rowCountTimer=setTimeout(refreshCount,20000);
 const el=document.querySelector('.oly-tk-row .oly-tk-rowcount');if(!el)return;
 try{await fresh(4000);const pid=await currentProject();const list=S.tasks.filter(t=>t.status!=='done'&&(!pid||t.projectId===pid));
  el.textContent=list.length?String(list.length):'';const b=el.closest('button');
  b.title=(pid?'Открытые задачи проекта «'+projTitle(pid)+'»: ':'Открытые задачи: ')+list.length+'. Упомяните задачу в сообщении через #.'}
 catch(e){el.textContent='';el.closest('button').title='Сервис задач не запущен (127.0.0.1:4518)'}}

/* ---------------- board ---------------- */
const B={view:LS('oly-tasks-view')||'board',priority:'all',status:'all',sort:'manual',hideDone:false,selected:new Set(),el:null,sel:LS('oly-tasks-sel')||'all',q:'',detail:null,adding:null,poll:0,modal:null};
function scopeIds(){if(B.sel==='all')return null;if(B.sel.startsWith('p:'))return[B.sel.slice(2)];if(B.sel.startsWith('g:')){const g=S.groups.find(x=>'g:'+x.id===B.sel);return g?g.projectIds:[]}return null}
function visible(){const ids=scopeIds();const live=new Set(S.projects.map(p=>p.id));const q=B.q.trim().toLowerCase();
 return S.tasks.filter(t=>live.has(t.projectId)&&(!ids||ids.includes(t.projectId))&&(!q||(t.id+' '+t.title+' '+t.description+' '+(t.labels||[]).join(' ')).toLowerCase().includes(q))&&(B.priority==='all'||t.priority===B.priority)&&(B.status==='all'||t.status===B.status)&&(!B.hideDone||t.status!=='done'))}
function multi(){const ids=scopeIds();return !ids||ids.length!==1}
function defaultProject(){const ids=scopeIds();const cur=knownCurrentProject();if(ids&&ids.length){return ids.includes(cur)?cur:ids[0]}return cur||(S.projects[0]||{}).id}
function closeBoard(){flushDetail();if(B.el)B.el.remove();B.el=null;B.detail=null;B.modal=null;clearInterval(B.poll);refreshCount();
 const ed=composerEditor();if(B.returnFocus&&document.contains(B.returnFocus))try{B.returnFocus.focus()}catch(e){}}
async function openBoard(opts){
 if(B.el)return;B.returnFocus=document.activeElement;
 const o=document.createElement('div');o.className='oly-tk-overlay';o.setAttribute('data-oly-tasks-overlay','');
 o.innerHTML='<div class="oly-tk-dialog" role="dialog" aria-modal="true" aria-label="Задачи"><div class="oly-tk-empty">Загрузка задач…</div></div>';
 o.addEventListener('mousedown',e=>{if(e.target===o)closeBoard()});
 /* keep T3's global shortcuts away from our inputs */
 for(const ev of['keydown','keyup','keypress'])o.addEventListener(ev,e=>{if(e.key!=='Escape')e.stopPropagation()});
 document.body.appendChild(o);B.el=o;
 const cur=await currentProject();
 if(cur&&!(opts&&opts.keepSel)){B.sel='p:'+cur}
 try{await loadAll()}catch(e){o.firstChild.innerHTML='<div class="oly-tk-empty">Сервис задач не запущен.<br>Он стартует при входе в Windows. Запустить вручную: <code>tasks-service\\start-hidden.vbs</code><br><br><button class="oly-tk-btn" data-act="retry">Повторить</button></div>';
  o.querySelector('[data-act=retry]').onclick=()=>{closeBoard();openBoard(opts)};return}
 if(B.sel.startsWith('p:')&&!projById(B.sel.slice(2)))B.sel='all';
 if(B.sel.startsWith('g:')&&!S.groups.some(g=>'g:'+g.id===B.sel))B.sel='all';
 renderBoard();
 B.poll=setInterval(async()=>{if(!B.el)return;const busy=B.el.querySelector('.oly-tk-body :is(input,textarea,select):focus')||B.el.querySelector('.dragging')||B.modal;
  try{const before=JSON.stringify(S.tasks)+JSON.stringify(S.projects);await loadAll();if(!busy&&before!==JSON.stringify(S.tasks)+JSON.stringify(S.projects)){renderBoard(true);syncDetail()}}catch(e){}},4000);
 if(opts&&opts.task)openDetail(opts.task)}
function navItem(sel,icon,label,count,extra){return'<button class="oly-tk-item'+(extra||'')+'" data-sel="'+esc(sel)+'" aria-current="'+(B.sel===sel)+'">'+(sel.startsWith('p:')?projectIconHtml(projById(sel.slice(2))):svg(icon))+'<span>'+esc(label)+'</span>'+((extra||'').includes('is-here')?'<i class="here" title="Проект текущего треда"></i>':'')+(count?'<small>'+count+'</small>':'')+'</button>'}

function projectIconHtml(p){
 if(p?.icon?.kind==='image'&&/^data:image\//.test(p.icon.url||''))return '<img class="oly-project-icon" alt="" style="background:'+(/^#[0-9a-f]{6}$/i.test(p.icon.background||'')?p.icon.background:'transparent')+'" src="'+esc(p.icon.url)+'">';
 if(p?.icon?.kind==='lucide'){const icons={'message-square-dashed':'<path d="M10 3H7m10 0h-3M3 7v3m0 4v3m4 4h3m4 0h3m4-4v-3m0-4V7M3 21l4-4"/>','folder':I.folder,'kanban':I.board,'code':'<path d="m8 5-7 7 7 7m8-14 7 7-7 7"/>'};return svg(icons[p.icon.name]||I.folder)}
 if(p?.icon?.kind==='emoji')return '<span class="oly-project-icon">'+esc(p.icon.emoji||p.icon.value||'')+'</span>';
 const label=(p?.title||'П').replace(/[^\p{L}\p{N}]/gu,'').slice(0,2).toUpperCase();let hash=0;for(const c of p?.id||'')hash=(hash*31+c.charCodeAt(0))>>>0;
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
function renderBoard(keepFocus){
 if(!B.el)return;const dlg=B.el.firstChild;
 const focusId=keepFocus&&document.activeElement&&document.activeElement.dataset&&document.activeElement.dataset.id;
 const scrolls=[...dlg.querySelectorAll('.oly-tk-list')].map(l=>l.scrollTop);
 const open=pid=>S.tasks.filter(t=>t.projectId===pid&&t.status!=='done').length;
 const cur=knownCurrentProject();
 const projects=S.projects.filter(p=>!p.archived||S.tasks.some(t=>t.projectId===p.id));
 let nav='<div class="oly-tk-navtitle">'+svg(I.board)+'Задачи</div>'+navItem('all',I.all,'Все проекты',S.tasks.filter(t=>t.status!=='done'&&projById(t.projectId)).length||'');
 nav+='<div class="oly-tk-sec"><span>Группы</span><button class="oly-tk-ico sm" data-act="newgroup" title="Новая группа проектов" aria-label="Новая группа">'+svg(I.plus)+'</button></div>';
 nav+=S.groups.length?S.groups.map(g=>navItem('g:'+g.id,I.group,g.name,g.projectIds.reduce((n,id)=>n+open(id),0)||'')).join(''):'<div class="oly-tk-sec" style="padding-top:2px;font-weight:400">Объединяйте проекты в группы, чтобы вести общую доску.</div>';
 nav+='<div class="oly-tk-sec"><span>Проекты</span></div>'+projects.map(p=>navItem('p:'+p.id,I.folder,p.title,open(p.id)||'',p.id===cur?' is-here':'')).join('');
 nav+='<div class="oly-tk-navfoot"><label><input type="checkbox" data-act="autostart"'+(LS('oly-tasks-autostart')==='0'?'':' checked')+'><span>Упомянутая через # задача из «Бэклога» переходит в «В работе»</span></label></div>';
 let title='Все проекты',sub='',gid=null;
 if(B.sel.startsWith('p:')){const p=projById(B.sel.slice(2));title=p?p.title:'Проект';sub=p?p.root:''}
 else if(B.sel.startsWith('g:')){const g=S.groups.find(x=>'g:'+x.id===B.sel);title=g?g.name:'Группа';gid=g&&g.id;sub=g?g.projectIds.map(projTitle).join(', '):''}
 const vis=visible();
 let head='<div class="oly-tk-crumb"><span class="m">Задачи</span><span class="m">/</span><h2>'+esc(title)+'</h2><span class="sub" title="'+esc(sub)+'">'+esc(sub.length>60?sub.slice(0,60)+'…':sub)+'</span></div>'+
  (gid?'<button class="oly-tk-btn ghost" data-act="editgroup" data-gid="'+esc(gid)+'">'+svg(I.pen)+'Группа</button>':'')+
  '<label class="oly-tk-search">'+svg(I.search)+'<input class="oly-tk-input" data-act="q" type="search" placeholder="Поиск задач" aria-label="Поиск задач" value="'+esc(B.q)+'"></label>'+
  '<button class="oly-tk-btn primary" data-act="new" title="Новая задача (N)">'+svg(I.plus)+'Новая задача</button>'+
  '<button class="oly-tk-ico" data-act="close" title="Закрыть (Esc)" aria-label="Закрыть">'+svg(I.x)+'</button>';
 let board='';
 for(const s of ST){if(B.hideDone&&s.id==='done'||B.status!=='all'&&s.id!==B.status)continue;const list=vis.filter(t=>t.status===s.id).sort(taskSort);
  board+='<section class="oly-tk-col" data-status="'+s.id+'" aria-label="'+s.label+'"><div class="oly-tk-colhead"><i class="oly-tk-dot" data-s="'+s.id+'"></i>'+s.label+' <small>'+list.length+'</small><span class="sp"></span><button class="oly-tk-ico sm" data-act="add" data-status="'+s.id+'" title="Добавить задачу в «'+s.label+'»" aria-label="Добавить задачу">'+svg(I.plus)+'</button></div><div class="oly-tk-list" data-status="'+s.id+'">'+
   (B.adding===s.id?addForm():'')+list.map(card).join('')+(B.adding!==s.id&&s.id!=='done'?'<button class="oly-tk-addbtn" data-act="add" data-status="'+s.id+'">'+svg(I.plus)+'Добавить задачу</button>':'')+'</div></section>'}
 const empty=!S.projects.length?'<div class="oly-tk-empty">Проекты T3 не найдены. Добавьте проект в T3, и здесь появится его доска.</div>':'';
 /* update parts in place: the detail pane and modals keep their DOM (and focus) */
 if(!dlg.querySelector(':scope > .oly-tk-nav')){dlg.innerHTML='<nav class="oly-tk-nav" aria-label="Проекты"></nav><div class="oly-tk-main"><div class="oly-tk-head"></div><div class="oly-tk-body"></div></div>'}
 const qFocused=document.activeElement&&document.activeElement.dataset&&document.activeElement.dataset.act==='q';
 dlg.querySelector('.oly-tk-nav').innerHTML=nav;
 if(!qFocused)dlg.querySelector('.oly-tk-head').innerHTML=head;else{const h=dlg.querySelector('.oly-tk-head');[...h.children].forEach(c=>{if(!c.classList.contains('oly-tk-search'))c.remove()});h.insertAdjacentHTML('afterbegin',head.split('<label class="oly-tk-search">')[0]);h.insertAdjacentHTML('beforeend',head.split('</label>').slice(1).join('</label>'))}
 dlg.querySelector('.oly-tk-body').innerHTML=taskToolbar(vis.length)+(empty||(B.view==='list'?taskList(vis):'<div class="oly-tk-board">'+board+'</div>'));
 dlg.querySelectorAll('.oly-tk-list').forEach((l,i)=>{l.scrollTop=scrolls[i]||0});
 bindBoard(dlg);
 if(B.adding){const i=dlg.querySelector('.oly-tk-add input');if(i)i.focus()}
 else if(focusId){const c=dlg.querySelector('.oly-tk-card[data-id="'+focusId+'"]');if(c)c.focus()}}
function addForm(){const m=multi();const def=defaultProject();const ids=scopeIds();const ps=ids?S.projects.filter(p=>ids.includes(p.id)):S.projects.filter(p=>!p.archived);
 return'<div class="oly-tk-add"><input class="oly-tk-input" data-act="addtitle" placeholder="Название задачи" aria-label="Название новой задачи">'+
  (m?'<div class="row"><select data-act="addproj" aria-label="Проект">'+ps.map(p=>'<option value="'+esc(p.id)+'"'+(p.id===def?' selected':'')+'>'+esc(p.title)+'</option>').join('')+'</select></div>':'')+
  '<div class="row" style="flex:0"><button class="oly-tk-btn primary" data-act="addok">Добавить</button><button class="oly-tk-btn ghost" data-act="addcancel">Отмена</button></div></div>'}
function card(t){const m=multi();const done=t.checklist.filter(c=>c.done).length;
 const meta='<div class="oly-tk-meta"><span class="id">'+esc(t.id)+'</span>'+(t.priority!=='normal'?'<span class="oly-tk-pr" data-p="'+t.priority+'">'+prLabel(t.priority)+'</span>':'')+(m?'<span class="oly-tk-proj">'+projectIconHtml(projById(t.projectId))+esc(projTitle(t.projectId))+'</span>':'')+'</div>';
 const desc=plain(t.description);
 const foot=(t.checklist.length?'<span class="ic'+(done===t.checklist.length?' ok':'')+'" title="Чек-лист">'+svg(I.list)+done+'/'+t.checklist.length+'</span>':'')+(t.notes.length?'<span class="ic" title="Заметки">'+svg(I.note)+t.notes.length+'</span>':'')+(t.notes.length||t.checklist.length?'<span title="Обновлена">'+ago(t.updatedAt)+'</span>':'');
 return'<div class="oly-tk-card" role="button" tabindex="0" draggable="true" data-id="'+esc(t.id)+'" aria-selected="'+(B.detail===t.id)+'" aria-label="'+esc(t.id+' '+t.title)+'">'+meta+(t.dueDate?'<span class="oly-tk-due '+(t.dueDate<new Date().toLocaleDateString('en-CA')&&t.status!=='done'?'late':'')+'">'+esc(t.dueDate)+'</span>':'')+(t.labels||[]).map(x=>'<span class="oly-tk-label">'+esc(x)+'</span>').join('')+'<div class="t">'+esc(t.title)+'</div>'+(desc?'<div class="d">'+esc(desc.slice(0,220))+'</div>':'')+'<div class="oly-tk-foot">'+foot+'</div></div>'}
function bindBoard(root){
 bindTaskToolbar(root);const dlg={querySelectorAll:s=>root.querySelectorAll(':is(.oly-tk-nav,.oly-tk-head,.oly-tk-body) '+s),querySelector:s=>root.querySelector(':is(.oly-tk-nav,.oly-tk-head,.oly-tk-body) '+s)};
 dlg.querySelectorAll('[data-sel]').forEach(b=>b.onclick=()=>{flushDetail();B.sel=b.dataset.sel;LS('oly-tasks-sel',B.sel);B.adding=null;closeDetail();renderBoard()});
 const q=dlg.querySelector('[data-act=q]');if(q&&!q._b){q._b=1;q.oninput=()=>{B.q=q.value;renderBoard()}}
 const on=(sel,fn)=>dlg.querySelectorAll(sel).forEach(e=>e.addEventListener('click',fn));
 on('[data-act=close]',closeBoard);
 on('[data-act=new]',()=>{B.adding=B.status==='all'?'backlog':B.status;renderBoard()});
 on('[data-act=add]',e=>{B.adding=e.currentTarget.dataset.status;renderBoard()});
 on('[data-act=addcancel]',()=>{B.adding=null;renderBoard()});
 on('[data-act=addok]',()=>submitAdd());
 on('[data-act=newgroup]',()=>groupModal(null));
 on('[data-act=editgroup]',e=>groupModal(e.currentTarget.dataset.gid));
 const at=dlg.querySelector('[data-act=autostart]');if(at)at.onchange=()=>LS('oly-tasks-autostart',at.checked?'1':'0');
 const ti=dlg.querySelector('[data-act=addtitle]');if(ti)ti.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();submitAdd()}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();B.adding=null;renderBoard()}};
 dlg.querySelectorAll('.oly-tk-card').forEach(c=>{
  c.addEventListener('click',()=>openDetail(c.dataset.id));
  c.addEventListener('keydown',e=>cardKey(e,c));
  c.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/x-oly-task',c.dataset.id);e.dataTransfer.effectAllowed='move';setTimeout(()=>c.classList.add('dragging'),0)});
  c.addEventListener('dragend',()=>{c.classList.remove('dragging');clearDrop()})});
 dlg.querySelectorAll('.oly-tk-list').forEach(l=>{
  l.addEventListener('dragover',e=>{if(![...e.dataTransfer.types].includes('text/x-oly-task'))return;e.preventDefault();e.dataTransfer.dropEffect='move';placeDrop(l,e.clientY)});
  l.addEventListener('drop',e=>{const id=e.dataTransfer.getData('text/x-oly-task');if(!id)return;e.preventDefault();const ph=l.querySelector('.oly-tk-drop');
   let nx=ph&&ph.nextElementSibling;while(nx&&!nx.classList.contains('oly-tk-card'))nx=nx.nextElementSibling;clearDrop();if(nx&&nx.dataset.id===id)return;move(id,l.dataset.status,nx?nx.dataset.id:null)})});
 const board=dlg.querySelector('.oly-tk-board');if(board)board.addEventListener('dragleave',e=>{if(!board.contains(e.relatedTarget))clearDrop()})}
function clearDrop(){if(!B.el)return;B.el.querySelectorAll('.oly-tk-drop').forEach(x=>x.remove());B.el.querySelectorAll('.oly-tk-list.over').forEach(x=>x.classList.remove('over'))}
function placeDrop(list,y){let ph=B.el.querySelector('.oly-tk-drop');if(!ph){ph=document.createElement('div');ph.className='oly-tk-drop'}
 B.el.querySelectorAll('.oly-tk-list.over').forEach(x=>x!==list&&x.classList.remove('over'));list.classList.add('over');
 const cards=[...list.querySelectorAll('.oly-tk-card:not(.dragging)')];const nx=cards.find(c=>{const r=c.getBoundingClientRect();return y<r.top+r.height/2});
 if(nx){if(ph.nextElementSibling!==nx)list.insertBefore(ph,nx)}else{const ab=list.querySelector('.oly-tk-addbtn');if(ab){if(ph.nextElementSibling!==ab)list.insertBefore(ph,ab)}else if(list.lastElementChild!==ph)list.appendChild(ph)}}
async function move(id,status,beforeId){const t=S.tasks.find(x=>x.id===id);if(!t)return;
 const col=S.tasks.filter(x=>x.status===status&&x.projectId===t.projectId&&x!==t).sort((a,b)=>a.order-b.order);
 /* order is per project; in multi-project boards place relative to the nearest card of the same project */
 let before=beforeId&&col.find(x=>x.id===beforeId)?beforeId:null;
 if(beforeId&&!before){const vis=visible().filter(x=>x.status===status).sort((a,b)=>a.order-b.order);const k=vis.findIndex(x=>x.id===beforeId);const nb=vis.slice(k).find(x=>x.projectId===t.projectId&&x!==t);before=nb?nb.id:null}
 const bi=before?col.findIndex(x=>x.id===before):-1;t.status=status;t.order=bi<0?(col.length?col[col.length-1].order+1024:1024):bi===0?col[0].order-1024:(col[bi-1].order+col[bi].order)/2;
 renderBoard(true);syncDetail();
 try{upsert(await api('POST','tasks/'+id+'/move',{status,beforeId:before}));renderBoard(true);syncDetail();refreshCount()}catch(e){toast('Не удалось переместить: '+e.message);await loadAll().catch(()=>{});renderBoard(true)}}
function cardKey(e,c){const id=c.dataset.id;const col=c.closest('.oly-tk-list');const cards=[...col.querySelectorAll('.oly-tk-card')];const i=cards.indexOf(c);
 const cols=[...B.el.querySelectorAll('.oly-tk-list')];const ci=cols.indexOf(col);const k=e.key;
 if(k==='Enter'||k===' '){e.preventDefault();openDetail(id);return}
 if(k==='Delete'){e.preventDefault();openDetail(id,true);return}
 if(e.altKey||e.ctrlKey){
  if(k==='ArrowLeft'||k==='ArrowRight'){e.preventDefault();const to=cols[ci+(k==='ArrowLeft'?-1:1)];if(to)move(id,to.dataset.status,null).then(()=>focusCard(id));return}
  if(k==='ArrowUp'&&i>0){e.preventDefault();move(id,col.dataset.status,cards[i-1].dataset.id).then(()=>focusCard(id));return}
  if(k==='ArrowDown'&&i<cards.length-1){e.preventDefault();move(id,col.dataset.status,cards[i+2]?cards[i+2].dataset.id:null).then(()=>focusCard(id));return}
  return}
 if(k==='ArrowDown'&&cards[i+1]){e.preventDefault();cards[i+1].focus()}
 else if(k==='ArrowUp'&&cards[i-1]){e.preventDefault();cards[i-1].focus()}
 else if(k==='ArrowLeft'||k==='ArrowRight'){e.preventDefault();for(let j=ci+(k==='ArrowLeft'?-1:1);j>=0&&j<cols.length;j+=(k==='ArrowLeft'?-1:1)){const cs=cols[j].querySelectorAll('.oly-tk-card');if(cs.length){cs[Math.min(i,cs.length-1)].focus();break}}}}
function focusCard(id){const c=B.el&&B.el.querySelector('.oly-tk-card[data-id="'+id+'"]');if(c)c.focus()}
async function submitAdd(){const i=B.el.querySelector('[data-act=addtitle]');if(!i)return;const title=i.value.trim();if(!title){i.focus();return}
 const ps=B.el.querySelector('[data-act=addproj]');const projectId=ps?ps.value:defaultProject();if(!projectId){toast('Выберите проект');return}
 i.disabled=true;try{const t=await api('POST','tasks',{projectId,title,status:B.adding});upsert(t);renderBoard();refreshCount()}catch(e){toast('Не удалось создать: '+e.message);i.disabled=false}}

/* ---------------- detail pane ---------------- */
let saveTimer=0,pendingSave=null;
function closeDetail(){flushDetail();const d=B.el&&B.el.querySelector('.oly-tk-detail');if(d)d.remove();const id=B.detail;B.detail=null;
 if(B.el){B.el.querySelectorAll('.oly-tk-card[aria-selected=true]').forEach(c=>c.setAttribute('aria-selected','false'));if(id)focusCard(id)}}
function flushDetail(){if(pendingSave){clearTimeout(saveTimer);const p=pendingSave;pendingSave=null;p()}}
function setSaved(txt){const s=B.el&&B.el.querySelector('.oly-tk-detail .sv');if(s)s.textContent=txt}
async function patch(id,body,quiet){if(pendingSave&&!('description' in body))flushDetail();setSaved('Сохранение…');try{const t=await api('PATCH','tasks/'+id,body);upsert(t);setSaved('Сохранено');renderBoard(true);if(!quiet)syncDetail(true);refreshCount();return t}catch(e){setSaved('Ошибка: '+e.message);return null}}
function openDetail(id,armDelete){const t=S.tasks.find(x=>x.id===id);if(!t||!B.el)return;flushDetail();B.detail=id;
 B.el.querySelectorAll('.oly-tk-card').forEach(c=>c.setAttribute('aria-selected',String(c.dataset.id===id)));
 let d=B.el.querySelector('.oly-tk-detail');if(!d){d=document.createElement('aside');d.className='oly-tk-detail';d.setAttribute('aria-label','Задача');B.el.querySelector('.oly-tk-main').appendChild(d)}
 d.dataset.id=id;d.dataset.updated=t.updatedAt;d.innerHTML=detailHtml(t);bindDetail(d,t);
 if(armDelete){const b=d.querySelector('[data-act=del]');b.focus();armDel(b)}else{const ti=d.querySelector('.oly-tk-title');if(ti&&!t.description&&Date.now()-Date.parse(t.createdAt)<60000)ti.focus();else d.querySelector('[data-act=dclose]').focus()}}
function syncDetail(force){if(!B.el||!B.detail)return;const d=B.el.querySelector('.oly-tk-detail');const t=S.tasks.find(x=>x.id===B.detail);if(!d)return;if(!t){closeDetail();return}
 const ae=document.activeElement,typing=d.contains(ae)&&ae.matches('input:not([type=checkbox]),textarea');
 if(!force&&(d.dataset.updated===t.updatedAt||typing))return;
 /* keep what the user is typing (focused field, unsent note / new checklist item) across the re-render */
 const keep={};d.querySelectorAll('input[data-f]:not([type=checkbox]),textarea[data-f]').forEach(el=>{if(el===ae||el.dataset.f==='note'||el.dataset.f==='cnew')keep[el.dataset.f]=[el.value,el.selectionStart,el.selectionEnd]});
 const sc=d.querySelector('.oly-tk-dbody').scrollTop;const f=ae&&d.contains(ae)?ae.dataset.f:null;const sv=(d.querySelector('.sv')||{}).textContent;
 d.dataset.updated=t.updatedAt;d.innerHTML=detailHtml(t);bindDetail(d,t);d.querySelector('.oly-tk-dbody').scrollTop=sc;if(sv)setSaved(sv);
 for(const k in keep){const el=d.querySelector('[data-f="'+k+'"]');if(el){el.value=keep[k][0];if(k==='title')autosize(el)}}
 if(f){const el=d.querySelector('[data-f="'+f+'"]');if(el){el.focus();if(keep[f])try{el.setSelectionRange(keep[f][1],keep[f][2])}catch(e){}}}}
let mdMode=LS('oly-tasks-mdmode')||'edit';
function detailHtml(t){const done=t.checklist.filter(c=>c.done).length;const ids=S.projects;
 const opts=(arr,v)=>arr.map(x=>'<option value="'+x.id+'"'+(x.id===v?' selected':'')+'>'+esc(x.label||x.title)+'</option>').join('');
 return'<div class="oly-tk-dhead"><span class="id">'+esc(t.id)+'</span><i class="oly-tk-dot" data-s="'+t.status+'"></i><span class="sv" aria-live="polite"></span><button class="oly-tk-ico" data-act="dclose" title="Закрыть задачу (Esc)" aria-label="Закрыть задачу">'+svg(I.x)+'</button></div>'+
 '<div class="oly-tk-dbody"><textarea class="oly-tk-title" data-f="title" rows="1" aria-label="Название" maxlength="300">'+esc(t.title)+'</textarea>'+
 '<div class="oly-tk-fields"><label for="oly-tk-f-st">Статус</label><select id="oly-tk-f-st" data-f="status">'+opts(ST,t.status)+'</select>'+
 '<label for="oly-tk-f-pr">Приоритет</label><select id="oly-tk-f-pr" data-f="priority">'+opts(PR,t.priority)+'</select>'+
 '<label for="oly-tk-f-pj">Проект</label><select id="oly-tk-f-pj" data-f="project">'+opts(ids.filter(p=>!p.archived||p.id===t.projectId),t.projectId)+'</select>'+
 '<label for="oly-tk-due">Срок</label><input id="oly-tk-due" class="oly-tk-input" type="date" data-f="due" value="'+esc(t.dueDate||'')+'">'+
 '<label for="oly-tk-labels">Метки</label><input id="oly-tk-labels" class="oly-tk-input" data-f="labels" placeholder="Через запятую" value="'+esc((t.labels||[]).join(', '))+'"></div>'+
 '<div class="oly-tk-block"><h4>Описание / план<span class="sp"></span><span class="oly-tk-tabs" role="group" aria-label="Режим описания"><button data-md="edit" aria-pressed="'+(mdMode==='edit')+'">Правка</button><button data-md="view" aria-pressed="'+(mdMode==='view')+'">Просмотр</button></span></h4>'+
 (mdMode==='view'?'<div class="oly-tk-md">'+md(t.description)+'</div>':'<textarea data-f="desc" rows="8" placeholder="Что сделать, план, критерии готовности. Поддерживается markdown." aria-label="Описание">'+esc(t.description)+'</textarea>')+'</div>'+
 '<div class="oly-tk-block"><h4>Чек-лист'+(t.checklist.length?' · '+done+'/'+t.checklist.length:'')+'</h4>'+(t.checklist.length?'<div class="oly-tk-prog"><i style="width:'+Math.round(done/t.checklist.length*100)+'%"></i></div>':'')+
 '<div class="oly-tk-cl">'+t.checklist.map((c,i)=>'<div class="oly-tk-ci'+(c.done?' done':'')+'"><input type="checkbox" data-f="ck'+i+'" data-ci="'+i+'"'+(c.done?' checked':'')+' aria-label="Выполнено"><input class="txt" data-f="ct'+i+'" data-ct="'+i+'" value="'+esc(c.text)+'" aria-label="Пункт '+(i+1)+'"><button class="oly-tk-ico sm" data-crm="'+i+'" title="Удалить пункт" aria-label="Удалить пункт">'+svg(I.x)+'</button></div>').join('')+
 '<div class="oly-tk-ci"><input type="checkbox" disabled aria-hidden="true" style="opacity:.35"><input class="txt" data-f="cnew" placeholder="Добавить пункт — Enter" aria-label="Новый пункт чек-листа"></div></div></div>'+
 '<div class="oly-tk-block"><h4>Заметки и ход работы</h4><div class="oly-tk-notes">'+t.notes.slice().reverse().map(n=>'<div class="oly-tk-n"><div class="w"><b>'+esc(n.by)+'</b> · '+esc(new Date(n.at).toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}))+'</div><div class="x">'+esc(n.text)+'</div></div>').join('')+
 '<div class="oly-tk-addnote"><textarea data-f="note" rows="2" placeholder="Заметка — Ctrl+Enter" aria-label="Новая заметка"></textarea><button class="oly-tk-btn" data-act="addnote">Добавить</button></div></div></div></div>'+
 '<div class="oly-tk-dfoot"><button class="oly-tk-btn primary" data-act="tochat"'+(composerEditor()?'':' disabled title="Откройте тред, чтобы вставить задачу в сообщение"')+'>'+svg(I.send)+'В чат</button><span class="info">Создана '+esc(ago(t.createdAt))+(t.createdAt!==t.updatedAt?' · изменена '+esc(ago(t.updatedAt)):'')+'</span><span class="sp"></span><button class="oly-tk-btn ghost danger" data-act="del">'+svg(I.trash)+'Удалить</button></div>'}
function armDel(b){b.classList.add('armed');b.lastChild.textContent='Точно удалить?';clearTimeout(b._t);b._t=setTimeout(()=>{b.classList.remove('armed');b.lastChild.textContent='Удалить'},4000)}
function autosize(ta){ta.style.height='auto';ta.style.height=ta.scrollHeight+'px'}
function bindDetail(d,t){const id=t.id;const q=s=>d.querySelector(s);
 q('[data-act=dclose]').onclick=closeDetail;
 const ti=q('.oly-tk-title');autosize(ti);ti.oninput=()=>autosize(ti);ti.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();ti.blur()}};
 ti.onchange=()=>{const v=ti.value.replace(/\s+/g,' ').trim();if(v&&v!==t.title)patch(id,{title:v},true);else ti.value=t.title};
 q('[data-f=status]').onchange=e=>patch(id,{status:e.target.value});
 q('[data-f=priority]').onchange=e=>patch(id,{priority:e.target.value});
 q('[data-f=project]').onchange=e=>patch(id,{projectId:e.target.value});
 q('[data-f=due]').onchange=e=>patch(id,{dueDate:e.target.value});
 q('[data-f=labels]').onchange=e=>patch(id,{labels:e.target.value.split(',')});
 d.querySelectorAll('[data-md]').forEach(b=>b.onclick=()=>{flushDetail();mdMode=b.dataset.md;LS('oly-tasks-mdmode',mdMode);syncDetail(true);const ta=q('[data-f=desc]');if(ta)ta.focus()});
 const ds=q('[data-f=desc]');if(ds){const save=()=>{pendingSave=null;if(ds.value!==t.description){t.description=ds.value;patch(id,{description:ds.value},true)}};
  ds.oninput=()=>{setSaved('Изменено');clearTimeout(saveTimer);pendingSave=save;saveTimer=setTimeout(save,900)};ds.onblur=()=>{if(pendingSave){clearTimeout(saveTimer);save()}}}
 const cl=()=>t.checklist.map(c=>({...c}));
 d.querySelectorAll('[data-ci]').forEach(cb=>cb.onchange=()=>{const l=cl();l[+cb.dataset.ci].done=cb.checked;patch(id,{checklist:l})});
 d.querySelectorAll('[data-ct]').forEach(inp=>{inp.onchange=()=>{const l=cl();const v=inp.value.trim();if(!v)l.splice(+inp.dataset.ct,1);else l[+inp.dataset.ct].text=v;patch(id,{checklist:l})};inp.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();inp.blur()}}});
 d.querySelectorAll('[data-crm]').forEach(b=>b.onclick=()=>{const l=cl();l.splice(+b.dataset.crm,1);patch(id,{checklist:l})});
 const cn=q('[data-f=cnew]');cn.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();const v=cn.value.trim();if(!v)return;cn.value='';patch(id,{addChecklist:[v]}).then(()=>{const n=B.el&&B.el.querySelector('.oly-tk-detail [data-f=cnew]');if(n)n.focus()})}};
 const nt=q('[data-f=note]');const addNote=()=>{const v=nt.value.trim();if(!v)return;nt.value='';patch(id,{note:v,by:'Вы'})};
 q('[data-act=addnote]').onclick=addNote;nt.onkeydown=e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();addNote()}};
 q('[data-act=tochat]').onclick=()=>{flushDetail();const tt=S.tasks.find(x=>x.id===id)||t;closeBoard();if(insertAtEnd(tt)){markStarted(tt);toast('Задача '+tt.id+' вставлена в сообщение')}};
 q('[data-act=del]').onclick=async e=>{const b=e.currentTarget;if(!b.classList.contains('armed')){armDel(b);return}
  try{await api('DELETE','tasks/'+id);S.tasks=S.tasks.filter(x=>x.id!==id);pendingSave=null;closeDetail();renderBoard();refreshCount();toast('Задача '+id+' удалена')}catch(err){toast('Не удалось удалить: '+err.message)}}}

/* ---------------- group editor ---------------- */
function groupModal(gid){const g=gid?S.groups.find(x=>x.id===gid):null;const sel=new Set(g?g.projectIds:[]);const cur=knownCurrentProject();if(!g&&cur)sel.add(cur);
 const m=document.createElement('div');m.className='oly-tk-modal';B.modal=m;
 m.innerHTML='<div class="oly-tk-mbox" role="dialog" aria-modal="true" aria-label="Группа проектов"><h3>'+(g?'Группа проектов':'Новая группа проектов')+'</h3><p>Общая доска для нескольких проектов: например, клиент, сервер и сайт одного продукта.</p><div class="oly-tk-mbody">'+
 '<input class="oly-tk-input" data-f="gname" placeholder="Название группы" aria-label="Название группы" value="'+esc(g?g.name:'')+'">'+
 '<div class="oly-tk-checks">'+S.projects.filter(p=>!p.archived||sel.has(p.id)).map(p=>'<label><input type="checkbox" value="'+esc(p.id)+'"'+(sel.has(p.id)?' checked':'')+'><span>'+esc(p.title)+'</span><small title="'+esc(p.root)+'">'+esc(p.root)+'</small></label>').join('')+'</div><div class="oly-tk-err"></div></div>'+
 '<div class="oly-tk-mfoot">'+(g?'<button class="oly-tk-btn ghost danger" data-act="gdel">'+svg(I.trash)+'Удалить группу</button>':'')+'<span class="sp"></span><button class="oly-tk-btn ghost" data-act="gcancel">Отмена</button><button class="oly-tk-btn primary" data-act="gsave">Сохранить</button></div></div>';
 B.el.firstChild.appendChild(m);const name=m.querySelector('[data-f=gname]');name.focus();
 const close=()=>{m.remove();B.modal=null};
 m.addEventListener('mousedown',e=>{if(e.target===m)close()});
 m.querySelector('[data-act=gcancel]').onclick=close;
 const save=async()=>{const ids=[...m.querySelectorAll('.oly-tk-checks input:checked')].map(x=>x.value);const err=m.querySelector('.oly-tk-err');
  if(!name.value.trim()){err.textContent='Введите название';name.focus();return}if(!ids.length){err.textContent='Отметьте хотя бы один проект';return}
  try{const r=await api('PUT','groups',{id:g&&g.id,name:name.value.trim(),projectIds:ids});await loadAll();B.sel='g:'+r.id;LS('oly-tasks-sel',B.sel);close();renderBoard()}catch(e){err.textContent=e.message}};
 m.querySelector('[data-act=gsave]').onclick=save;name.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();save()}};
 const del=m.querySelector('[data-act=gdel]');if(del)del.onclick=async()=>{if(!del.classList.contains('armed')){armDel(del);del.lastChild.textContent='Точно удалить группу?';return}
  try{await api('DELETE','groups/'+encodeURIComponent(g.id));await loadAll();B.sel='all';LS('oly-tasks-sel','all');close();renderBoard()}catch(e){m.querySelector('.oly-tk-err').textContent=e.message}}}

/* board-level keys */
addEventListener('keydown',e=>{if(!B.el)return;
 if(e.key==='Escape'){e.preventDefault();e.stopPropagation();
  if(B.modal){B.modal.remove();B.modal=null;return}
  if(B.adding){B.adding=null;renderBoard();return}
  if(B.detail){closeDetail();return}
  closeBoard();return}
 const typing=e.target&&e.target.closest&&e.target.closest('input,textarea,select,[contenteditable=true]');
 if(!typing&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&B.el.contains(e.target)||(!typing&&e.target===document.body)){
  if(e.key==='n'||e.key==='т'){e.preventDefault();B.adding=B.status==='all'?'backlog':B.status;renderBoard()}
  else if(e.key==='/'){e.preventDefault();const s=B.el.querySelector('[data-act=q]');if(s)s.focus()}}},true);

/* ---------------- «#» mentions in the composer ---------------- */
const P={el:null,ctx:null,items:[],idx:0,dismissed:null,seq:0};
function mentionCtx(){const sel=getSelection();if(!sel||!sel.isCollapsed||!sel.anchorNode)return null;const n=sel.anchorNode;if(n.nodeType!==3)return null;
 const ed=n.parentElement&&n.parentElement.closest('[data-slot=composer-host] .composer-tiptap');if(!ed)return null;
 const before=n.data.slice(0,sel.anchorOffset);const m=/(^|[\s(«"' ])#([^\s#]{0,40})$/.exec(before);if(!m)return null;
 return{ed,node:n,start:sel.anchorOffset-m[2].length-1,end:sel.anchorOffset,q:m[2]}}
function closePop(){if(P.el)P.el.remove();P.el=null;P.ctx=null;P.items=[]}
function rank(t,q){if(!q)return 1;q=q.toLowerCase();const id=t.id.toLowerCase(),ti=t.title.toLowerCase();
 if(id===q||id==='t-'+q)return 100;if(id.startsWith(q)||('t-'+q)===id.slice(0,q.length+2))return 60;if(ti.startsWith(q))return 50;if(ti.includes(q))return 30;if(String(t.description||'').toLowerCase().includes(q))return 10;return 0}
const ORD={doing:0,backlog:1,review:2,done:3};
async function updatePop(){const ctx=mentionCtx();
 if(!ctx){closePop();return}
 const key=ctx.node.data.slice(0,ctx.start)+'|'+ctx.start;if(P.dismissed&&P.dismissed.node===ctx.node&&P.dismissed.key===key)return;P.dismissed=null;
 P.ctx=ctx;const seq=++P.seq;
 try{await fresh(3000);await currentProject()}catch(e){closePop();return}
 if(seq!==P.seq)return;
 const cur=knownCurrentProject();const live=new Set(S.projects.map(p=>p.id));const q=ctx.q;
 const scored=S.tasks.filter(t=>live.has(t.projectId)).map(t=>({t,r:rank(t,q)})).filter(x=>x.r>0&&(x.t.status!=='done'||q));
 scored.sort((a,b)=>((b.t.projectId===cur)-(a.t.projectId===cur))||b.r-a.r||ORD[a.t.status]-ORD[b.t.status]||a.t.order-b.t.order);
 const items=scored.slice(0,40).map(x=>x.t);
 if(!items.length){closePop();return}
 P.items=items;if(P.idx>=items.length)P.idx=0;renderPop(cur)}
function renderPop(cur){
 if(!P.el){P.el=document.createElement('div');P.el.className='oly-tk-pop';P.el.setAttribute('data-oly-tasks-pop','');
  P.el.addEventListener('mousedown',e=>e.preventDefault());document.body.appendChild(P.el)}
 let h='<div class="oly-tk-pophead">'+svg(I.hash)+'<span>Задачи — упомяните, чтобы агент её получил</span><span class="sp"></span><kbd>↑↓</kbd><kbd>Enter</kbd><kbd>Esc</kbd></div><div class="oly-tk-poplist" role="listbox" aria-label="Задачи">';
 let group=null;
 P.items.forEach((t,i)=>{const g=t.projectId===cur?'cur':'other';
  if(g!==group){group=g;h+='<div class="oly-tk-popg">'+(g==='cur'?esc(projTitle(cur)):cur?'Другие проекты':'Все проекты')+'</div>'}
  h+='<div class="oly-tk-opt" role="option" data-i="'+i+'" aria-selected="'+(i===P.idx)+'"><span class="id">'+esc(t.id)+'</span><span class="tt">'+esc(t.title)+(g==='other'?'<small>'+esc(projTitle(t.projectId))+'</small>':'')+'</span><span class="st"><i class="oly-tk-dot" data-s="'+t.status+'"></i>'+stLabel(t.status)+'</span></div>'});
 P.el.innerHTML=h+'</div>';
 P.el.querySelectorAll('.oly-tk-opt').forEach(o=>{o.onclick=()=>choose(+o.dataset.i);o.onmousemove=()=>{if(P.idx!==+o.dataset.i){P.idx=+o.dataset.i;markActive()}}});
 placePop();markActive()}
function placePop(){if(!P.el||!P.ctx)return;const host=P.ctx.ed.closest('[data-chat-composer-main-surface]')||P.ctx.ed.closest('[data-slot=composer-host]');const r=host.getBoundingClientRect();
 P.el.style.left=Math.max(8,r.left)+'px';P.el.style.width=Math.min(r.width,innerWidth-16)+'px';P.el.style.bottom=Math.max(8,innerHeight-r.top+6)+'px';P.el.style.maxHeight=Math.min(320,r.top-16)+'px'}
function markActive(){if(!P.el)return;P.el.querySelectorAll('.oly-tk-opt').forEach(o=>{const on=+o.dataset.i===P.idx;o.setAttribute('aria-selected',String(on));if(on)o.scrollIntoView({block:'nearest'})})}
function choose(i){const t=P.items[i];const ctx=P.ctx;if(!t||!ctx)return;closePop();
 const n=ctx.node;if(!n.isConnected||n.data.slice(ctx.start,ctx.start+1)!=='#'){toast('Не удалось вставить задачу');return}
 const end=Math.min(n.data.length,ctx.start+1+ctx.q.length);ctx.ed.focus();getSelection().setBaseAndExtent(n,ctx.start,n,end);
 document.execCommand('insertText',false,refText(t));markStarted(t)}
let popRaf=0;const schedulePop=()=>{if(popRaf)return;popRaf=requestAnimationFrame(()=>{popRaf=0;updatePop()})};
document.addEventListener('selectionchange',()=>{if(P.el||(document.activeElement&&document.activeElement.classList&&document.activeElement.classList.contains('composer-tiptap')))schedulePop()});
document.addEventListener('input',e=>{if(e.target&&e.target.closest&&e.target.closest('.composer-tiptap'))schedulePop()},true);
document.addEventListener('focusout',e=>{if(P.el&&e.target&&e.target.classList&&e.target.classList.contains('composer-tiptap'))setTimeout(()=>{if(!document.activeElement||!document.activeElement.closest('.composer-tiptap'))closePop()},120)},true);
addEventListener('resize',()=>placePop());
addEventListener('keydown',e=>{if(!P.el||e.isComposing)return;if(!e.target||!e.target.closest||!e.target.closest('.composer-tiptap'))return;
 const k=e.key;let handled=true;
 if(k==='ArrowDown'){P.idx=(P.idx+1)%P.items.length;markActive()}
 else if(k==='ArrowUp'){P.idx=(P.idx-1+P.items.length)%P.items.length;markActive()}
 else if((k==='Enter'&&!e.shiftKey)||k==='Tab'){choose(P.idx)}
 else if(k==='Escape'){const c=P.ctx;if(c)P.dismissed={node:c.node,key:c.node.data.slice(0,c.start)+'|'+c.start};closePop()}
 else handled=false;
 if(handled){e.preventDefault();e.stopImmediatePropagation()}},true);

/* ---------------- wiring ---------------- */
globalThis.__olyTasks={open:openBoard,close:closeBoard,state:S,board:B,pop:P,refText};
let pending=false;const tick=()=>{pending=false;ensureRow()};
let lastPath=location.pathname+location.hash;
const start=()=>{addCss();new MutationObserver(()=>{if(!pending){pending=true;requestAnimationFrame(tick)}}).observe(document.body,{childList:true,subtree:true});tick();
 setInterval(()=>{if(location.pathname+location.hash!==lastPath){lastPath=location.pathname+location.hash;refreshCount();if(P.el)closePop()}},800)};
document.body?start():addEventListener('DOMContentLoaded',start);
}catch(e){console.warn('oly tasks',e)}})();

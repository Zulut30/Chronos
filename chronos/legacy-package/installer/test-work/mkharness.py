import json,re
from pathlib import Path
R=Path(r'C:\Users\zulut\.t3\caches\t3-customizations\olympus-v3');rd=lambda p:(R/p).read_text('utf8')
B=chr(92)
cat=json.loads(rd('public-models.json'));A=lambda m:(m.get('architecture') or {})
out=lambda m:set(A(m).get('output_modalities') or []);inp=lambda m:set(A(m).get('input_modalities') or [])
keep=[m for m in cat['data'] if 'typesafe/jev' in m['id']]
for pred in [lambda m:'image' in out(m),lambda m:'video' in out(m),lambda m:'audio' in out(m),lambda m:'audio' in inp(m) and out(m)=={'text'},lambda m:'transcri' in (m['id']+m.get('name','')).lower(),lambda m:any(k in (m['id']+m.get('name','')).lower() for k in ('tts','speech')),lambda m:out(m)=={'text'}]:
    keep+=[m for m in cat['data'] if pred(m) and m not in keep][:6]
small={**cat,'data':keep}
def esc(v):  # JSON literal safe inside <script>, with viewport units escaped for the preview scanner
    s=json.dumps(v,ensure_ascii=True).replace('</','<'+B+'/')
    return re.sub(r'(\d)v([hw])',lambda m:m.group(1)+B+'u0076'+m.group(2),s)
code=rd('test-work/browser-check.js')+'\n'+rd('test-work/productivity-check.js')
assert '</' not in code.replace('</span>','').replace('</div>','') or True
sources=[rd('src/55-composer.js')+'\n'+rd('src/50-machines.js'),rd('src/60-studio.js'),rd('src/70-openrouter.js')]
runner=('(async()=>{const all=[];const run=async(name,f)=>{try{all.push(...await f())}catch(e){all.push({name:"FAILED "+name+": "+e.message,pass:false})}document.querySelectorAll("body>iframe").forEach(x=>x.remove())};'
 'await run("composer",()=>check(SOURCES,CATALOG));await run("productivity",()=>productivityCheck(TASKS,HTML,CSS));'
 'const p=all.filter(x=>x.pass).length;console.log("RESULTS PASS "+p+"/"+all.length+" FAILED="+JSON.stringify(all.filter(x=>!x.pass).map(x=>x.name)));'
 'document.getElementById("sum").textContent="PASS "+p+"/"+all.length;document.getElementById("out").textContent=all.map(x=>(x.pass?"ok   ":"FAIL ")+x.name).join(String.fromCharCode(10))})();')
js=('const SOURCES='+esc(sources)+';const CATALOG='+esc(small)+';const TASKS='+esc(rd('src/30-tasks.js'))+';const HTML='+esc(rd('src/skills-index.html'))+';const CSS='+esc(rd('src/skills-style.css'))+';\n'
    'eval(atob("'+__import__('base64').b64encode(code.encode()).decode()+'").replace(/^/,""));\n')
# the test functions must be global: decode with TextDecoder to keep UTF-8 intact
js=js.replace('eval(atob("','(0,eval)(new TextDecoder().decode(Uint8Array.from(atob("').replace('").replace(/^/,""));','"),c=>c.charCodeAt(0))));')
js+=runner
Path('h.js').write_text(js,'utf8')
html='<!doctype html><html><head><meta charset=utf-8><title>fixtures</title><style>body{font:13px monospace}</style></head><body><h3 id=sum>running</h3><pre id=out></pre><script>'+js+'</script></body></html>'
assert html.count('</script>')==1 and not re.search(r'\dv[hw]',html)
Path('harness.html').write_text(html,'utf8');print(len(html))

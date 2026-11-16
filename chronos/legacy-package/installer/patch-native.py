from pathlib import Path
R=Path(__file__).parent;OUT=R/'native';OUT.mkdir(exist_ok=True)
def rep(s,a,b):
 assert s.count(a)==1,(a[:90],s.count(a));return s.replace(a,b)
def file(name,fn):
 s=(R/'installed'/name).read_text('utf8');s=fn(s);(OUT/name).write_text(s,encoding='utf8')
def composer(s):
 s=rep(s,'function Jx(e){return Kx(e)}','function Jx(e){return globalThis.__olyReferences?.lex(e,Kx)??Kx(e)}')
 s=rep(s,'function MT(e){let t=(0,J.use)(vT);return jT.render(e.kind,t.get(e.contextId),{label:e.label})}', 'function MT(e){let t=(0,J.use)(vT);return e.kind?.startsWith(`oly-`)?(0,Y.jsx)(`span`,{className:`oly-reference-chip`,title:e.kind===`oly-model`?e.contextId:e.label,children:e.label}):jT.render(e.kind,t.get(e.contextId),{label:e.label})}')
 s=rep(s,'Спросите что угодно. @ файлы, $ скиллы, / команды','Спросите что угодно. @ контекст, # задачи, ! поиск, $ скиллы, / команды')
 return s
file('ThreadDetailsItemsMenu-nmodI3O-.js',composer)
file('utils-BTU7ae6Y.js',lambda s:rep(s,'qF=z([`claude`,`codex`,`grok`,`cursor`,`opencode`,`antigravity`,`pi`,`muse`])','qF=z([`claude`,`codex`,`grok`,`cursor`,`opencode`,`openrouter`,`antigravity`,`pi`,`muse`])'))
def contract(s):
 i=s.index('const UsageProviderKind =');end=s.index(']);',i)+3;a=s[:i];b=s[i:end];b=rep(b,'\t"opencode",','\t"opencode",\n\t"openrouter",');return a+b+s[end:]
file('ManagedEndpointRuntime--5XAAKR8.mjs',contract)
file('UsageLimits-MnFl4D3C.js',lambda s:rep(s,'opencode:{label:`OpenCode`,color:`#5b9bbd`,driverKind:m.make(`opencode`)},','opencode:{label:`OpenCode`,color:`#5b9bbd`,driverKind:m.make(`opencode`)},openrouter:{label:`OpenRouter`,color:`#6467F2`,driverKind:m.make(`opencode`)},'))
def server(s):
 a=s.index('function parseOpenCodeMessage(');b=s.index('const rowCache =',a);p=s[a:b]
 p=rep(p,'if (totalTokens(totals) === 0) return null;','if (totalTokens(totals) === 0 && !message.olyOpenrouterReceipt) return null;')
 p=rep(p,'provider: "opencode",','provider: providerId === "openrouter" ? "openrouter" : "opencode",')
 p=rep(p,'(cost > 0 || free && cost === 0)','(cost > 0 || (free || providerId === "openrouter") && cost === 0)')
 p=rep(p,'`opencode:${id}`','`${providerId === "openrouter" ? "openrouter" : "opencode"}:${id}`')
 s=s[:a]+p+s[b:]
 s=rep(s,'for (const root of roots?.length ? roots : defaults) {','for (const root of [...(roots?.length ? roots : defaults),path.join(homeDirectory,".t3","userdata","openrouter-usage")]) {')
 # Partition sources as well as records, so provider filters and source diagnostics agree.
 a=s.index('const scanReaders =');b=s.index('const providerRateModels',a)
 s=s[:a]+'''function olyUsagePartition(sources,provider){return sources.map(source=>({...source,files:source.files?.map(file=>({...file,records:file.records.filter(record=>record.provider===provider)})).filter(file=>file.records.length)||null}))}
const scanReaders = BUILT_IN_USAGE_DRIVERS.flatMap(driver=>{
 if(driver.usage?.kind!=="scan")return [];
 if(driver!==OpenCodeDriver)return [{driver,reader:driver.usage}];
 return ["opencode","openrouter"].map(provider=>({driver,reader:{...driver.usage,provider,scan:input=>driver.usage.scan(input).pipe(map(sources=>olyUsagePartition(sources,provider)))}}));
});
'''+s[b:]
 return s
file('server-syNn-CpO.mjs',server)
print('Native changes staged')

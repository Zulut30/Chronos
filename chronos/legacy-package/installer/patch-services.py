from pathlib import Path
R=Path(__file__).parent;BASE=R.parent
def rep(s,a,b):
 assert s.count(a)==1,(a[:90],s.count(a));return s.replace(a,b)
s=(R/'before/openrouter-service--server.mjs').read_text('utf8')
s=rep(s,"const HERE =", "import {writeReceipt} from './usage-ledger.mjs';\nimport {audioTools} from './audio-tools.mjs';\nconst HERE =")
s=rep(s,"const VERSION = '1.0.0';","const VERSION = '1.1.0';")
s=rep(s,'  return res.json();', '''  const result=await res.json();
  if(auth&&((method==='POST'&&body?.model)||method==='GET'&&/^\\/api\\/v1\\/videos\\/[^/]+$/.test(p)&&result.model)){
   try{writeReceipt(result,body?.model||result.model,{id:result.id||result.data?.id})}catch{log('usage receipt could not be saved')}
  }
  return result;''')
i=s.index('// ---------- MCP stdio')
s=s[:i]+"Object.assign(tools,audioTools({api,findModel,resolveOutDir,uniquePath,slug,stamp,UserError,writeReceipt}));\n\n"+s[i:]
s=rep(s,"'для decision-моделей — decide, для текстовых — chat_once. Файлы", "'для decision-моделей — decide, для текстовых — chat_once. Для speech — generate_speech, transcription — transcribe_audio, audio — generate_audio. Файлы")
(R/'src/openrouter-server.mjs').write_text(s,encoding='utf8')
s=(R/'before/integrations-service--mcp.mjs').read_text('utf8')
s="import {hackernewsSearch} from './hackernews.mjs';\n"+s if not s.startswith('#!') else s.replace('\n',"\nimport {hackernewsSearch} from './hackernews.mjs';\n",1)
s=rep(s,'const TOOLS = [', '''const TOOLS = [
 {name:'hackernews_search',handler:hackernewsSearch,annotations:RO,description:'Поиск публикаций Hacker News через публичный Algolia API, без ключа и платы. Возвращает статьи и ссылки на обсуждения.',inputSchema:S({query:{type:'string'},limit:{type:'integer',minimum:1,maximum:30},sort:{type:'string',enum:['relevance','date']}},['query'])},''')
s=rep(s,'Каждый вызов платный (цена в описании).','hackernews_search — Hacker News, бесплатно и без ключа. Остальные вызовы используют настроенные API (цена в описании). Указание !web, !reddit, !x, !youtube или !hn в сообщении выбирает соответствующий источник поиска; запрос — следующий за указанием текст.')
(R/'src/web-mcp.mjs').write_text(s,encoding='utf8')
print('Service changes staged')

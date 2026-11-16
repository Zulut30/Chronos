import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import http from 'node:http';
import {spawn} from 'node:child_process';
import readline from 'node:readline';
import {fileURLToPath} from 'node:url';
import {receipt,writeReceipt} from '../src/usage-ledger.mjs';
import {audioTools} from '../src/audio-tools.mjs';
import {hackernewsSearch} from '../src/hackernews.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'oly-v3-test-'));
process.env.OLY_TASKS_DIR=path.join(temp,'tasks');process.env.OLY_T3_DB=path.join(temp,'projects.db');
const Store=await import('../src/tasks-store.mjs');
const server=fs.readFileSync(path.join(root,'native/server-syNn-CpO.mjs'),'utf8');
const parseSource=server.slice(server.indexOf('function parseOpenCodeMessage('),server.indexOf('const rowCache =',server.indexOf('function parseOpenCodeMessage(')));
const ctx={object:o=>o&&typeof o==='object'?o:{},text$1:s=>typeof s==='string'?s:'',tokens:n=>Number.isFinite(n)&&n>=0?n:0,totalTokens:t=>t.uncachedInputTokens+t.cachedInputTokens+t.cacheCreationTokens+t.outputTokens,LITELLM_PREFIXES:new Map(),OPENCODE_GATEWAYS:new Set()};vm.createContext(ctx);vm.runInContext(parseSource,ctx);
const parse=r=>ctx.parseOpenCodeMessage(JSON.stringify(r));
test('usage_separates_openrouter_and_opencode',()=>{
 const r=receipt({id:'a',usage:{prompt_tokens:100,prompt_tokens_details:{cached_tokens:20},completion_tokens:10,cost:.003}},'test/model',{at:1000});
 const x=parse(r);assert.equal(x.provider,'openrouter');assert.equal(x.totals.uncachedInputTokens,80);assert.equal(x.totals.cachedInputTokens,20);assert.equal(x.reportedCostUsd,.003);
 assert.equal(parse({...r,providerID:'anthropic'}).provider,'opencode');assert.equal(x.dedupeKey,'openrouter:a');
});
test('usage_unknown_cost_is_not_free_and_zero_cost_is_preserved',()=>{
 const unknown=parse(receipt({id:'b'},'test/model'));assert.equal(unknown.reportedCostUsd,null);assert.equal(unknown.totals.outputTokens,0);
 assert.equal(parse(receipt({id:'c',usage:{cost:0}},'test/model')).reportedCostUsd,0);
});
test('usage_video_polls_update_one_receipt',()=>{
 const options={root:path.join(temp,'usage'),at:1000};let f=writeReceipt({id:'video-1'},'test/video',options);
 writeReceipt({id:'video-1',usage:{cost:.7}},'test/video',{...options,at:2000});writeReceipt({id:'video-1'},'test/video',options);
 const j=JSON.parse(fs.readFileSync(f));assert.equal(j.cost,.7);assert.equal(j.time.created,1000);assert.equal(fs.readdirSync(path.dirname(f)).length,1);assert.equal(j.tokens.output,0);
});
test('native_usage_partitions_sources_consistently',()=>{
 const a=server.indexOf('function olyUsagePartition('),b=server.indexOf('const scanReaders',a);vm.runInContext(server.slice(a,b),ctx);
 const src=[{dir:'root',files:[{path:'mixed.db',records:[{provider:'openrouter'},{provider:'opencode'}]}]}];
 assert.equal(ctx.olyUsagePartition(src,'openrouter')[0].files[0].records.length,1);assert.equal(ctx.olyUsagePartition(src,'openrouter')[0].files[0].records[0].provider,'openrouter');assert.equal(src[0].files[0].records.length,2);
});
test('opencode_openrouter_zero_cost_stays_unpriced_unless_free_or_receipt',()=>{
 const m={role:'assistant',id:'z',providerID:'openrouter',modelID:'new/model',time:{created:1000},tokens:{input:10,output:5},cost:0};
 assert.equal(parse(m).reportedCostUsd,null);
 assert.equal(parse({...m,modelID:'new/model:free'}).reportedCostUsd,0);
 assert.equal(parse({...m,cost:.01}).reportedCostUsd,.01);
});
test('native_openrouter_pricing_preserves_unknown_and_actual_cost',()=>{
 const a=server.indexOf('function priceUsage('),b=server.indexOf('function cacheSavingsUsd',a);vm.runInContext(server.slice(a,b),ctx);
 const r={provider:'openrouter',model:'test/model',totals:{},reportedCostUsd:null};assert.equal(ctx.priceUsage({},r).costSource,'unpriced');assert.equal(ctx.priceUsage({},{...r,reportedCostUsd:.25}).costUsd,.25);assert.equal(ctx.priceUsage({},{...r,reportedCostUsd:0}).costSource,'providerReported');
});
test('audio_dispatches_all_three_endpoints_without_paid_network',async()=>{
 const calls=[],saved=[];const env={findModel:async id=>({id,kinds:[id]}),resolveOutDir:()=>temp,uniquePath:(d,n,e)=>path.join(d,n+'.'+e),slug:x=>x,stamp:()=>String(calls.length),UserError:Error,writeReceipt:(...a)=>saved.push(a),api:async(method,p,o)=>{calls.push({method,p,o});if(p.endsWith('/speech'))return new Response(Buffer.from('FAKEAUDIO'),{headers:{'content-type':'audio/mpeg','x-generation-id':'speech-1'}});if(p.endsWith('/transcriptions'))return {text:'recognized'};return {choices:[{message:{audio:{data:Buffer.from('audio').toString('base64'),transcript:'hi'}}}]}}};
 const t=audioTools(env);await t.generate_speech.run({model:'speech',text:'hello',voice:'voice'});
 const f=path.join(temp,'input.wav');fs.writeFileSync(f,'test');assert.equal(await t.transcribe_audio.run({model:'transcription',file:f}),'recognized');await t.generate_audio.run({model:'audio',prompt:'hello'});
 assert.deepEqual(calls.map(c=>c.p),['/api/v1/audio/speech','/api/v1/audio/transcriptions','/api/v1/chat/completions']);assert.equal(calls[0].o.body.input,'hello');assert.equal(calls[1].o.body.input_audio.data,Buffer.from('test').toString('base64'));assert.equal(saved.length,1);
 await assert.rejects(()=>t.generate_speech.run({model:'text',text:'bad',voice:'v'}));
});
test('hackernews_builds_search_and_discussion_links',async()=>{
 let url;const text=await hackernewsSearch({query:'test topic',limit:3},{fetcher:async u=>{url=u;return {ok:true,json:async()=>({hits:[{title:'Story',objectID:'123',url:'https://example.invalid',points:7}]})}}});
 assert.equal(new URL(url).searchParams.get('query'),'test topic');assert.equal(new URL(url).searchParams.get('tags'),'story');assert.match(text,/news.ycombinator.com\/item\?id=123/);
});
test('tasks_dates_labels_and_project_move_preserve_data',()=>{
 const t=Store.createTask({projectId:'project-1',title:'Test',dueDate:'2026-11-20',labels:['UI','UI',' Bug '],checklist:['Step']});assert.deepEqual(t.labels,['UI','Bug']);
 const moved=Store.updateTask(t.id,{projectId:'project-2',status:'doing'});assert.equal(moved.dueDate,'2026-11-20');assert.equal(moved.checklist[0].text,'Step');
 Store.updateTask(t.id,{dueDate:'',labels:[]});assert.equal(Store.getTask(t.id).dueDate,null);assert.deepEqual(Store.getTask(t.id).labels,[]);assert.throws(()=>Store.updateTask(t.id,{dueDate:'2026-02-30'}));assert.equal(Store.getTask(t.id).title,'Test');
});
test('projects_reuse_native_image_and_custom_icon',async()=>{
 const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(process.env.OLY_T3_DB);db.exec('CREATE TABLE projection_projects(project_id text,title text,workspace_root text,deleted_at text,archived_at text,pinned_at text,favicon_path text,project_icon_json text)');
 const img=path.join(temp,'icon.png');fs.writeFileSync(img,Buffer.from([137,80,78,71]));const add=db.prepare('INSERT INTO projection_projects VALUES(?,?,?,NULL,NULL,NULL,?,?)');add.run('p1','Image',temp,img,null);add.run('p2','Custom',temp,null,JSON.stringify({kind:'emoji',emoji:'⭐'}));db.close();
 const p=await Store.t3Projects();assert.match(p.find(p=>p.id==='p1').icon.url,/^data:image\/png;base64,/);assert.equal(p.find(p=>p.id==='p2').icon.emoji,'⭐');
});
test('mcp_protocol_exposes_media_and_writes_real_usage_receipt',async t=>{
 const mock=http.createServer((req,res)=>{let data='';req.on('data',c=>data+=c);req.on('end',()=>{
  res.setHeader('content-type','application/json');
  if(req.url.startsWith('/api/v1/models'))return res.end(JSON.stringify({data:[{id:'mock/transcription',name:'Mock',architecture:{output_modalities:['transcription']}}]}));
  if(req.url==='/api/v1/audio/transcriptions'){const body=JSON.parse(data);assert.equal(body.model,'mock/transcription');assert.equal(body.input_audio.format,'wav');return res.end(JSON.stringify({id:'transcribe-mock',model:body.model,text:'Mock transcript',usage:{prompt_tokens:5,completion_tokens:2,cost:.004}}))}
  res.statusCode=404;res.end('{}');
 })});await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));t.after(()=>mock.close());
 const ledger=path.join(temp,'protocol-usage'),child=spawn(process.execPath,[path.join(root,'src/openrouter-server.mjs')],{cwd:temp,windowsHide:true,env:{...process.env,OPENROUTER_API_KEY:'FAKE_LOCAL_TEST_KEY',OPENROUTER_BASE_URL:'http://127.0.0.1:'+mock.address().port,OLY_USAGE_ROOT:ledger}});t.after(()=>child.kill());
 const pending=new Map();let seq=0;readline.createInterface({input:child.stdout}).on('line',line=>{const m=JSON.parse(line);pending.get(m.id)?.(m.result)});
 function call(method,params){return new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>reject(Error('mock MCP timeout')),5000);pending.set(id,r=>{clearTimeout(timer);pending.delete(id);resolve(r)});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n')})}
 const init=await call('initialize',{protocolVersion:'2025-06-18'});assert.equal(init.serverInfo.version,'1.1.0');const tools=await call('tools/list');for(const name of ['generate_image','generate_video','generate_speech','generate_audio','transcribe_audio','decide'])assert.ok(tools.tools.some(t=>t.name===name));
 const audio=path.join(temp,'protocol.wav');fs.writeFileSync(audio,'mock');const result=await call('tools/call',{name:'transcribe_audio',arguments:{model:'mock/transcription',file:audio}});assert.equal(result.content[0].text,'Mock transcript');assert.ok(!result.isError);
 const dir=path.join(ledger,'storage/message/openrouter-mcp');const records=fs.readdirSync(dir).map(f=>JSON.parse(fs.readFileSync(path.join(dir,f))));assert.equal(records.length,1);assert.equal(records[0].cost,.004);assert.equal(records[0].modelID,'mock/transcription');assert.ok(!JSON.stringify(records).includes('FAKE_LOCAL_TEST_KEY'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import {spawnSync,spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const HERE=path.dirname(fileURLToPath(import.meta.url));
function fixture(){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'oly-mcp-test-'));
 fs.mkdirSync(path.join(home,'.codex'),{recursive:true});
 const codex='# preserve root comment\nmodel="sample"\nprompt="""\n[mcp_servers.fake]\nleave this prompt alone\n"""\n[mcp_servers.existing]\ncommand="node"\nargs=["server.mjs"]\n[mcp_servers.existing.env]\nTOKEN="private-value"\n[other]\nsetting=7\n';
 fs.writeFileSync(path.join(home,'.codex/config.toml'),codex);
 fs.writeFileSync(path.join(home,'.claude.json'),JSON.stringify({oauthAccount:{private:'auth-preserved'},mcpServers:{existing:{command:'node',args:['-secret','private-argument'],env:{TOKEN:'private-value'}}},projects:{}}));
 const env={...process.env,USERPROFILE:home,HOME:home,CODEX_HOME:path.join(home,'.codex'),CHRONOS_T3_HOME:path.join(home,'.t3'),CHRONOS_SERVICES_DATA:path.join(home,'.t3')};
 const call=req=>{const r=spawnSync(process.execPath,[path.join(HERE,'worker.cjs')],{env,input:JSON.stringify(req),encoding:'utf8'});assert.equal(r.error,undefined);assert.ok(r.stdout,r.stderr);return JSON.parse(r.stdout)};
 const list=location=>call({action:'list',location});
 const change=(location,action,data)=>call({action,location,version:list(location).version,...data});
 return {home,env,call,list,change,codex,cleanup:()=>fs.rmSync(home,{recursive:true,force:true,maxRetries:10,retryDelay:100})};
}
test('codex_add_toggle_delete_preserves_unrelated_toml',()=>{
 const f=fixture();try{
  assert.equal(f.change('codex:user','add',{name:'demo',config:{url:'https://example.org/mcp',headers:{Authorization:'private-new'}}}).ok,true);
  assert.equal(f.list('codex:user').servers.find(x=>x.name==='demo').transport,'http');
  assert.equal(f.change('codex:user','toggle',{name:'demo',enabled:false}).ok,true);
  assert.equal(f.list('codex:user').servers.find(x=>x.name==='demo').enabled,false);
  assert.equal(f.change('codex:user','delete',{name:'demo'}).ok,true);
  const now=fs.readFileSync(path.join(f.home,'.codex/config.toml'),'utf8');
  assert.ok(now.includes(f.codex.trim()));assert.ok(now.includes('TOKEN="private-value"'));
  assert.equal(f.list('codex:user').servers.length,1);
 }finally{f.cleanup()}
});
test('claude_disable_restore_delete_retains_credentials_and_backup',()=>{
 const f=fixture();try{
  const off=f.change('claude:user','toggle',{name:'existing',enabled:false});assert.equal(off.ok,true);
  assert.equal(f.list('claude:user').servers[0].enabled,false);
  const raw=JSON.parse(fs.readFileSync(path.join(f.home,'.claude.json')));
  assert.deepEqual(raw.oauthAccount,{private:'auth-preserved'});assert.deepEqual(raw.mcpServers,{});
  assert.ok(fs.existsSync(path.join(off.backup,'config.before')));
  assert.equal(f.change('claude:user','toggle',{name:'existing',enabled:true}).ok,true);
  const restored=JSON.parse(fs.readFileSync(path.join(f.home,'.claude.json'))).mcpServers.existing;
  assert.equal(restored.env.TOKEN,'private-value');assert.equal(restored.args[1],'private-argument');
  assert.equal(f.change('claude:user','delete',{name:'existing'}).ok,true);assert.equal(f.list('claude:user').servers.length,0);
 }finally{f.cleanup()}
});
test('listing_redacts_secrets_arguments_and_url_query',()=>{
 const f=fixture();try{
  f.change('codex:user','add',{name:'remote',config:{url:'https://user:password@example.org/mcp?token=hidden',env:{KEY:'secret-value'}}});
  for(const loc of ['codex:user','claude:user']){
   const out=JSON.stringify(f.list(loc));
   for(const secret of ['private-value','private-argument','secret-value','password','token=hidden'])assert.ok(!out.includes(secret),secret);
  }
 }finally{f.cleanup()}
});
test('duplicate_invalid_config_and_stale_version_do_not_write',()=>{
 const f=fixture();try{
  const before=fs.readFileSync(path.join(f.home,'.codex/config.toml'),'utf8'),v=f.list('codex:user').version;
  assert.ok(f.change('codex:user','add',{name:'existing',config:{command:'node'}}).error);
  assert.ok(f.change('codex:user','add',{name:'../bad',config:{command:'node'}}).error);
  assert.ok(f.change('codex:user','add',{name:'bad',config:{url:'file:///tmp/a'}}).error);
  assert.ok(f.change('codex:user','add',{name:'bad',config:{command:'node',args:'not-array'}}).error);
  assert.ok(f.change('codex:user','toggle',{name:'existing',enabled:'false'}).error);
  assert.equal(fs.readFileSync(path.join(f.home,'.codex/config.toml'),'utf8'),before);
  fs.appendFileSync(path.join(f.home,'.codex/config.toml'),'\n# external change\n');
  assert.ok(f.call({action:'delete',location:'codex:user',name:'existing',version:v}).error);
  assert.ok(fs.readFileSync(path.join(f.home,'.codex/config.toml'),'utf8').includes('# external change'));
 }finally{f.cleanup()}
});
test('project_scope_does_not_modify_user_servers',()=>{
 const f=fixture();try{
  const project=path.join(f.home,'project');fs.mkdirSync(project);
  const p=path.join(f.home,'.claude.json'),j=JSON.parse(fs.readFileSync(p));j.projects[project]={mcpServers:{privateproject:{command:'node'}}};fs.writeFileSync(p,JSON.stringify(j));
  const locs=f.call({action:'locations'}).locations;
  const local=locs.find(x=>x.agent==='claude'&&x.scope==='local');
  assert.ok(local);
  assert.equal(f.change(local.id,'delete',{name:'privateproject'}).ok,true);
  assert.equal(f.list('claude:user').servers[0].name,'existing');
  const shared=locs.find(x=>x.agent==='claude'&&x.scope==='project');
  assert.equal(f.change(shared.id,'add',{name:'shared',config:{type:'http',url:'https://example.org/mcp'}}).ok,true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(project,'.mcp.json'))).mcpServers.shared.url,'https://example.org/mcp');
  assert.equal(f.change(shared.id,'toggle',{name:'shared',enabled:false}).ok,true);
  assert.equal(f.list(shared.id).servers.find(x=>x.name==='shared').enabled,false);
  assert.ok(JSON.parse(fs.readFileSync(p)).projects[project].disabledMcpServers.includes('shared'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(project,'.mcp.json'))).mcpServers.shared.url,'https://example.org/mcp');
  assert.equal(f.change(shared.id,'toggle',{name:'shared',enabled:true}).ok,true);
  assert.equal(f.list(shared.id).servers.find(x=>x.name==='shared').enabled,true);
 }finally{f.cleanup()}
});
test('inline_parent_toml_fails_without_corrupting_config',()=>{
 const f=fixture();try{
  const p=path.join(f.home,'.codex/config.toml'),raw='model="sample"\nmcp_servers={existing={command="node"}}\n';fs.writeFileSync(p,raw);
  assert.ok(f.change('codex:user','delete',{name:'existing'}).error);
  assert.equal(fs.readFileSync(p,'utf8'),raw);
 }finally{f.cleanup()}
});
test('http_api_restricts_mutations_origins_and_ssh_targets',async()=>{
 const f=fixture(), socket=net.createServer();
 await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
 const port=socket.address().port;
 await new Promise(resolve=>socket.close(resolve));
 const server=spawn(process.execPath,[path.join(HERE,'server.mjs')],{env:{...f.env,OLY_MCP_TEST_HOME:f.home,OLY_MCP_PORT:String(port)},stdio:'ignore',windowsHide:true});
 try{
  let ready=false;for(let i=0;i<50;i++){try{ready=(await fetch('http://127.0.0.1:'+port+'/api/health')).ok;if(ready)break}catch{}await new Promise(r=>setTimeout(r,100))}
  assert.ok(ready);
  const base='http://127.0.0.1:'+port;
  assert.equal((await fetch(base+'/api/delete',{method:'POST',body:'{}'})).status,403);
  assert.equal((await fetch(base+'/api/machines',{headers:{Origin:'https://untrusted.invalid'}})).status,403);
  const invalid=await(await fetch(base+'/api/locations?machine=unknown-ssh')).json();assert.match(invalid.error,/Неизвестное SSH/);
  const locs=await(await fetch(base+'/api/locations')).json();assert.ok(Array.isArray(locs.locations),JSON.stringify(locs));assert.ok(locs.locations.some(x=>x.id==='codex:user'));
  const current=await(await fetch(base+'/api/servers?location=codex%3Auser')).json();
  const add=await fetch(base+'/api/add',{method:'POST',headers:{'x-oly':'1','content-type':'application/json'},body:JSON.stringify({location:'codex:user',name:'through-http',version:current.version,config:{command:'node'}})});
  assert.equal(add.status,200);assert.equal((await add.json()).ok,true);
 }finally{
  server.kill();if(server.exitCode===null)await new Promise(r=>server.once('exit',r));f.cleanup();
 }
});

test('SSH input runs with an empty remote installation and keeps request data literal', async () => {
 const {sshWorkerInput}=await import('./server.mjs');
 const f=fixture();
 try {
  const req={action:'list',location:'claude:user'};
  const r=spawnSync(process.execPath,['--input-type=commonjs','-'],{cwd:f.home,env:f.env,input:sshWorkerInput(req),encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),f.call(req));
 }finally{f.cleanup()}
});

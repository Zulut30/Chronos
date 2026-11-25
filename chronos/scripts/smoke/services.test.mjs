import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

const resources = process.env.CHRONOS_TEST_RESOURCES || path.resolve(import.meta.dirname, '../../services');
const httpServices = [
  ['tasks-service','TASKS','/api/health'], ['skills-manager','SKILLS','/api/health'],
  ['files-service','FILES','/health'], ['studio-service','STUDIO','/api/health'],
  ['integrations-service','INTEGRATIONS','/api/health'], ['mcp-manager','MCP','/api/health'],
  ['olympus-hub','HUB','/mcp/oly-web'],
];
async function freePort() {
  const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const { port } = socket.address(); const closed = once(socket, 'close'); socket.close(); await closed;
  return port;
}
test('seven hosted HTTP modules and OpenRouter stdio', async () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chronos-services-')));
  const home = path.join(tmp, 'home'), t3 = path.join(tmp, 'server'), data = path.join(tmp, 'service data');
  const project = path.join(tmp, 'example project'), downloads = path.join(home,'Downloads');
  for (const dir of [home,project,downloads,path.join(t3,'userdata')]) fs.mkdirSync(dir,{recursive:true});
  const db = new DatabaseSync(path.join(t3,'userdata','statev2.sqlite'));
  db.exec('CREATE TABLE projection_projects (project_id TEXT,title TEXT,workspace_root TEXT,deleted_at TEXT,archived_at TEXT, pinned_at TEXT, favicon_path TEXT, project_icon_json TEXT)');
  db.prepare('INSERT INTO projection_projects VALUES (?,?,?,NULL,NULL,NULL,NULL,NULL)').run('example','Fixture',project);
  db.close();
  const env = { ...process.env, HOME:home, USERPROFILE:home, CODEX_HOME:path.join(home,'.codex'),
    CHRONOS_T3_HOME:t3, CHRONOS_SERVICES_DATA:data, OLY_FILES_DEST:downloads };
  for (const key of Object.keys(env)) {
    if ((key.startsWith('OLY_') && key!=='OLY_FILES_DEST') || /API_KEY$/.test(key)) delete env[key];
  }
  const tasksDir = process.platform === 'win32' ? path.join(tmp,'configured tasks') : path.join(data,'tasks');
  if (process.platform === 'win32') env.Oly_Tasks_Dir = tasksDir;
  try {
    fs.mkdirSync(path.join(t3,'logs','services'),{recursive:true});
    for (const [name, variable, health] of httpServices) {
      const port = await freePort(), base = 'http://127.0.0.1:' + port;
      const proc = spawn(process.execPath,[path.join(resources,'host.mjs')],{
        cwd:tmp,env:{...env,['OLY_'+variable+'_PORT']:String(port)},windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],
      });
      proc.send(name);
      const exited = once(proc,'exit');
      try {
        let ready=false;
        for(let i=0;i<100 && proc.exitCode===null;i++){
          try { const r=await fetch(base+health); await r.arrayBuffer(); ready=r.status===(variable==='HUB'?401:200); if(ready)break; }catch{}
          await delay(50);
        }
        assert.ok(ready,name+' readiness');
        const get=async p=>{const r=await fetch(base+p);assert.equal(r.status,200,p);return r.json()};
        if(variable==='TASKS'){
          assert.equal((await get(health)).data,tasksDir);
          assert.ok((await get('/api/projects')).some(p=>p.id==='example'));
        }else if(variable==='SKILLS'){
          assert.ok((await get('/api/prompts')).prompts.length);
          assert.ok(fs.existsSync(path.join(data,'prompts','.initialized')));
        }else if(variable==='FILES'){
          const r=await fetch(base+'/save?name=fixture.txt',{method:'POST',headers:{'x-oly':'1'},body:'fixture'});
          assert.equal(r.status,200);assert.equal(fs.readFileSync(path.join(downloads,'fixture.txt'),'utf8'),'fixture');
        }else if(variable==='STUDIO'){
          assert.ok((await get('/api/locations')).locations.some(l=>l.root===project));
          const ctx=await get('/api/context');
          const r=await fetch(base+'/api/board/create',{method:'POST',headers:{'x-oly':'1'},body:JSON.stringify({name:'Fixture',dir:ctx.boardsDir})});
          assert.equal(r.status,200);assert.equal((await get('/api/boards?dir='+encodeURIComponent(ctx.boardsDir))).boards.length,1);
          const hub=await(await fetch(base+'/')).text();assert.doesNotMatch(hub,/api\/wp|tab-wp/);
          assert.equal((await fetch(base+'/board')).status,200);
          assert.equal((await fetch(base+'/excalidraw/app.js')).status,200);
          assert.equal((await fetch(base+'/api/wp/sites')).status,404);
        }else if(variable==='INTEGRATIONS'){
          if(process.platform!=='win32') {
            const value=randomUUID();
            const modify=(route,payload)=>fetch(base+'/api/keys'+route,{method:'POST',
              headers:{'x-oly':'1','content-type':'application/json'},body:JSON.stringify(payload)});
            const saved=await modify('',{id:'openrouter',value});
            assert.equal(saved.status,200);
            const file=path.join(data,'integrations-service','keys.env');
            assert.equal(fs.statSync(file).mode & 0o777,0o600);
            assert.equal(fs.statSync(path.dirname(file)).mode & 0o777,0o700);
            assert.ok(fs.readFileSync(file,'utf8').includes(value));
            const listed=await(await fetch(base+'/api/keys')).text();
            assert.ok(listed.includes(value.slice(-4)));assert.ok(!listed.includes(value));
            assert.equal((await modify('/delete',{id:'openrouter'})).status,200);
            assert.ok(!fs.readFileSync(file,'utf8').includes(value));
          }
        }else if(variable==='MCP'){
          assert.ok((await get('/api/locations')).locations.some(l=>l.project===project));
        }else{
          const tokens=JSON.parse(fs.readFileSync(path.join(data,'olympus-hub','credentials.json')));
          for(const endpoint of ['t3-studio','oly-web']){
            const r=await fetch(base+'/mcp/'+endpoint,{method:'POST',headers:{Authorization:'Bearer '+tokens[endpoint],'Content-Type':'application/json'},
              body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});
            assert.equal(r.status,200);const {tools}=(await r.json()).result;assert.ok(tools.length);assert.ok(tools.every(t=>!t.name.startsWith('wp_')));
          }
        }
      }finally{if(proc.exitCode===null)proc.kill();await exited;}
    }
    const r=spawnSync(process.execPath,[path.join(resources,'openrouter-service/server.mjs')],{
      cwd:tmp,env,input:'{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n',encoding:'utf8',timeout:8000});
    assert.equal(r.status,0);assert.ok(JSON.parse(r.stdout).result.tools.length);
    assert.equal(fs.existsSync(path.join(home,'.t3')),false);
  }finally{fs.rmSync(tmp,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});

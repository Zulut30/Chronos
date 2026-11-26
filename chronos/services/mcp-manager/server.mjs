import { serveLanguageAsset } from "../ui-language/serve.mjs";
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const HOME=process.env.OLY_MCP_TEST_HOME||os.homedir();
const PORT=Number(process.env.OLY_MCP_PORT||4523);
const HOST_RE=/^[A-Za-z0-9][A-Za-z0-9._@-]{0,127}$/;
const origins=new Set(['t3code://app','http://localhost:3773','http://127.0.0.1:3773',`http://127.0.0.1:${PORT}`,`http://localhost:${PORT}`]);
export function hosts(){
  let text='';try{text=fs.readFileSync(path.join(HOME,'.ssh/config'),'utf8')}catch{}
  return [...new Set(text.split(/\r?\n/).flatMap(line=>/^\s*Host\s+(.+)/i.exec(line)?.[1].split(/\s+/).filter(h=>HOST_RE.test(h))||[]))];
}
function run(cmd,args,input,timeout){
  return new Promise((resolve,reject)=>{
    const child=spawn(cmd,args,{windowsHide:true,env:{...process.env,...(process.env.OLY_MCP_TEST_HOME?{HOME,USERPROFILE:HOME,CODEX_HOME:path.join(HOME,'.codex')}:{})}});
    let out='',bytes=0,done=false;
    const finish=(error)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(out)};
    const timer=setTimeout(()=>{child.kill();finish(Error('Время ожидания истекло. Проверьте подключение и доступность Node.js 22.13+'))},timeout);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',chunk=>{bytes+=Buffer.byteLength(chunk);if(bytes>2e6){child.kill();finish(Error('Ответ конфигурации слишком большой'))}else out+=chunk.toString('utf8')});
    child.stderr.resume();
    child.on('error',()=>finish(Error('Не удалось запустить обработчик конфигурации')));
    child.on('close',code=>{if(!out.trim()&&code!==0)finish(Error('Не удалось подключиться. Нужны SSH-доступ без пароля и Node.js 22.13+'));else finish()});
    child.stdin.on('error',()=>{});child.stdin.end(input);
  });
}
export function sshWorkerInput(request) {
  const parser = fs.readFileSync(path.join(HERE,'vendor/toml.cjs'),'utf8');
  const worker = fs.readFileSync(path.join(HERE,'worker.cjs'),'utf8')
    .replace("require('./vendor/toml.cjs')", 'bundledToml')
    .replace("if (require.main === module) main(fs.readFileSync(0));", '');
  const input = Buffer.from(JSON.stringify(request)).toString('base64');
  return "const bundledToml = {}; (function(exports){\n" + parser + "\n})(bundledToml);\n" +
    worker + "\nmain(Buffer.from('" + input + "', 'base64'));\n";
}
export async function invoke(machine,request){
  let out;
  if(machine==='local')out=await run(process.execPath,[path.join(HERE,'worker.cjs')],JSON.stringify(request),15000);
  else {
    if(!hosts().includes(machine))throw Error('Неизвестное SSH-окружение');
    out=await run('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=8','-o','StrictHostKeyChecking=yes','--',machine,'node --input-type=commonjs -'],sshWorkerInput(request),25000);
  }
  let value;try{value=JSON.parse(out.trim())}catch{throw Error('Устройство вернуло некорректный ответ; конфигурация не подтверждена')}
  if(value.error)throw Error(value.error);
  return value;
}
function send(res,status,value,type='application/json; charset=utf-8',origin){
  const headers={'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
  if(origins.has(origin))headers['access-control-allow-origin']=origin;
  res.writeHead(status,headers);res.end(typeof value==='string'?value:JSON.stringify(value));
}
export function createServer(){return http.createServer(async(req,res)=>{
  try{
    if(![`127.0.0.1:${PORT}`,`localhost:${PORT}`].includes(req.headers.host))return send(res,403,{error:'Недопустимый Host'});
    if(req.headers.origin&&!origins.has(req.headers.origin))return send(res,403,{error:'Недопустимый источник'});
    const u=new URL(req.url,`http://127.0.0.1:${PORT}`),origin=req.headers.origin;
    if (req.method === "GET" && u.pathname.startsWith("/chronos-ui-") && await serveLanguageAsset(u.pathname, res)) return;
    const staticFiles={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};
    if(req.method==='GET'&&staticFiles[u.pathname]){const [name,type]=staticFiles[u.pathname];return send(res,200,fs.readFileSync(path.join(HERE,name),'utf8'),type,origin)}
    if(req.method==='GET'){
      if(u.pathname==='/api/health')return send(res,200,{ok:true,service:'oly-mcp-manager',port:PORT},undefined,origin);
      if(u.pathname==='/api/machines')return send(res,200,[{id:'local',label:'Этот компьютер',kind:'local'},...hosts().map(h=>({id:h,label:h,kind:'ssh'}))],undefined,origin);
      if(u.pathname==='/api/locations')return send(res,200,await invoke(u.searchParams.get('machine')||'local',{action:'locations'}),undefined,origin);
      if(u.pathname==='/api/servers')return send(res,200,await invoke(u.searchParams.get('machine')||'local',{action:'list',location:u.searchParams.get('location')}),undefined,origin);
    }
    if(req.method==='POST'){
      if(req.headers['x-oly']!=='1')return send(res,403,{error:'Требуется заголовок x-oly'});
      let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>150000)return send(res,413,{error:'Запрос слишком большой'})}
      const body=JSON.parse(raw),action=u.pathname.split('/').pop();
      if(!['add','toggle','delete'].includes(action)||u.pathname!==`/api/${action}`)return send(res,404,{error:'Не найдено'});
      return send(res,200,await invoke(body.machine||'local',{action,location:body.location,name:body.name,version:body.version,config:body.config,enabled:body.enabled}),undefined,origin);
    }
    send(res,404,{error:'Не найдено'});
  }catch(error){send(res,400,{error:error instanceof SyntaxError?'Некорректный JSON запроса':error.message})}
})}
if(import.meta.main)createServer().listen(PORT,'127.0.0.1',()=>console.log(`MCP manager: 127.0.0.1:${PORT}`));

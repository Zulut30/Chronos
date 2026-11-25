import {createSandbox} from "./sandbox.mjs";
import {createServer} from "node:http";
import {execFileSync} from "node:child_process";
import {setTimeout as delay} from "node:timers/promises";
import {writeFileSync} from "node:fs";
import path from "node:path";
import {once} from "node:events";

const [electron,native,out] = process.argv.slice(2);
const page = `<!doctype html><meta charset=utf-8><title>План задач</title><body style="background:#faf9f5;font:22px system-ui"><h1>План задач</h1><ol><li>Проверить сборку<li>Сверить план</ol>
<script>new PerformanceObserver(list=>{if(list.getEntries().some(e=>e.name==="first-contentful-paint"))fetch("/paint",{method:"POST"})}).observe({type:"paint",buffered:true})</script>`;

function footprint(pid) {
  const script = `$all=Get-CimInstance Win32_Process
  $queue=[Collections.Generic.Queue[int]]::new()
  $queue.Enqueue(${pid})
  $private=0L
  $working=0L
  $count=0
  while($queue.Count) {
    $current=$queue.Dequeue()
    $p=Get-Process -Id $current -ErrorAction SilentlyContinue
    if ($p) {$private+=$p.PrivateMemorySize64; $working+=$p.WorkingSet64; $count++}
    foreach ($child in $all.Where({$_.ParentProcessId -eq $current})) {$queue.Enqueue($child.ProcessId)}
  }
  @{privateBytes=$private;workingSet=$working;processes=$count} | ConvertTo-Json -Compress`;
  return JSON.parse(execFileSync("powershell.exe",["-NoProfile","-NonInteractive","-Command",script],{encoding:"utf8",windowsHide:true}));
}
async function sample(host) {
  const box=createSandbox(0,0);
  let mark;
  const painted=new Promise(resolve=>{mark=resolve;});
  const server=createServer((req,res)=>{
    if(req.method==="POST" && req.url==="/paint") {mark(performance.now());res.writeHead(204).end();return;}
    res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"}).end(page);
  });
  try {
    server.listen(0,"127.0.0.1");await once(server,"listening");
    const env={...box.env,ARTIFACT_BENCH_PROFILE:box.profile,ARTIFACT_BENCH_URL:"http://127.0.0.1:"+server.address().port};
    const start=performance.now();
    const child=box.start(host==="Electron" ? electron : native,host==="Electron" ? [path.join(import.meta.dirname,"artifact-electron.cjs")] : [],env);
    const stop=new AbortController();
    let first;
    try {
      first=await Promise.race([painted,once(child,"exit").then(([code])=>{throw Error(host+" exited "+code+" "+child.errors);}),
        delay(45000,null,{signal:stop.signal}).then(()=>{throw Error(host+" paint timeout "+child.errors);})]);
    } finally {stop.abort();}
    await delay(1500);
    return {host,firstPaintMs:Math.round(first-start),...footprint(child.pid)};
  } finally {server.closeAllConnections();server.close();box.close();}
}
const results=[];
for(const host of ["Electron","WebView2","WebView2","Electron","Electron","WebView2"]) {
  const row=await sample(host);results.push(row);console.log(JSON.stringify(row));
}
writeFileSync(out,JSON.stringify(results,null,2));

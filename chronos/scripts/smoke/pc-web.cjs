const assert = require("node:assert/strict");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { mkdtemp, rm } = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const os = require("node:os");

async function smoke(tools) {
  const {createController} = require(path.resolve(tools,"controller.cjs"));
  const dir = await mkdtemp(path.join(os.tmpdir(),"chronos-web-"));
  const name = "chronos-test-" + randomUUID();
  const socket = process.platform === "win32" ? "\\\\.\\pipe\\" + name : path.join(dir,"broker.sock");
  const key = randomUUID();
  const secret = "synthetic-fixture";
  let posted;
  const server = http.createServer((req,res) => {
    if (req.method === "POST" && req.url === "/done") {
      let data = "";
      req.setEncoding("utf8").on("data",chunk => { data += chunk; }).on("end",() => {
        posted = new URLSearchParams(data);
        res.end("ok");
      });
    } else {
      res.setHeader("content-type","text/html");
      res.end('<form action="/done" method="post"><label>City<input name="city" type="text"></label><label>Code<input name="code" type="password"></label><button>Submit</button></form>');
    }
  });
  await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
  const target = "http://127.0.0.1:" + server.address().port;
  const seen = new Set();
  const controller = createController({dir,tools,socket,key,shortcut:{register:()=>true,unregister(){}},notify(){
    for (const p of controller.state().pending) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      queueMicrotask(() => controller.ui({op:"decide",id:p.id,allow:true,...(p.manual ? {value:secret} : {})}));
    }
  }});
  async function request(request,expect=true) {
    const child = spawn(process.execPath,[path.resolve(tools,"bin/client.cjs")],{
      env:{...process.env,CHRONOS_PC_SOCKET:socket,CHRONOS_PC_KEY:key},stdio:["pipe","pipe","inherit"],
    });
    let text = "";
    child.stdout.on("data",chunk => {text += chunk;});
    child.stdin.end(JSON.stringify(request));
    const code = await new Promise((resolve,reject) => {child.once("error",reject); child.once("close",resolve);});
    const result = JSON.parse(text);
    assert.equal(result.ok,expect,`${request.op}: ${result.error ?? code}`);
    return result;
  }
  try {
    assert.equal(controller.state().settings.enabled,false);
    await controller.ui({op:"configure",settings:{enabled:true,all:false,apps:[target],mode:"none"}});
    await request({op:"open",kind:"web",target:"http://example.invalid"},false);
    const {session} = await request({op:"open",kind:"web",target});
    for (const [name,op,value] of [["City","fill","Warsaw"],["Code","fill","agent-value-must-be-ignored"],["Submit","click"]]) {
      const {elements} = await request({op:"snapshot",session});
      const element = elements.find(e=>e.name===name);
      assert.ok(element,name);
      await request({op,session,ref:element.ref,value});
    }
    assert.equal(posted?.get("city"),"Warsaw");
    assert.equal(posted?.get("code"),secret);
    assert.equal(seen.size,3);
    await request({op:"close",session});
    assert.equal(JSON.stringify(controller.state().history).includes(secret),false);
    await controller.ui({op:"stop"});
    console.log("PASS packaged client, whitelist, headless form, mandatory approvals, protected input and independent HTTP receipt");
  } finally {
    controller.stop();
    await new Promise(resolve => server.close(resolve));
    await rm(dir,{recursive:true,force:true,maxRetries:3});
  }
}
smoke(process.argv[2]).catch(error => {console.error(error);process.exitCode = 1;});

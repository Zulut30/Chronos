import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { artifactStore } from "./tools.mjs";
import { handleRequest } from "../studio-service/mcp.mjs";

test("MCP discovers tools lazily, publishes and reads", async t => {
  const root = mkdtempSync(path.join(tmpdir(),"chronos-artifact-mcp-"));
  const previousRoot = process.env.CHRONOS_SERVICES_DATA;
  process.env.CHRONOS_SERVICES_DATA = root;
  t.after(async () => {
    (await artifactStore()).close();
    if (previousRoot === undefined) delete process.env.CHRONOS_SERVICES_DATA;
    else process.env.CHRONOS_SERVICES_DATA = previousRoot;
    rmSync(root,{recursive:true,force:true});
  });
  async function request(method, params) {
    let result;
    await handleRequest({jsonrpc:"2.0",id:1,method,params}, msg => { result = msg.result; });
    return result;
  }
  assert.ok((await request("tools/list")).tools.some(tool => tool.name === "artifact_publish"));
  assert.equal(existsSync(path.join(root,"userdata")),false);
  async function call(name,args) {
    const result = await request("tools/call",{name,arguments:args});
    assert.ok(!result.isError,result.content[0].text);
    return JSON.parse(result.content[0].text);
  }
  const {writeFileSync} = await import("node:fs");
  const source=path.join(root,"local.html");
  writeFileSync(source,"<title>Локальный файл</title>");
  const created=await call("artifact_publish",{source,title:"Локальный файл",description:"Пример страницы.",icon:"book",label:"Из файла"});
  assert.match(created.quickstart,/:root/);
  assert.ok(created.markdown.includes(created.id));
  assert.equal((await call("artifact_read",{id:created.id})).files["index.html"],"<title>Локальный файл</title>");
  const {id} = await call("artifact_publish",{source:path.join(root,"index.html"),title:"Test page",
    description:"Test.",icon:"book",label:"First",files:{"index.html":"hello"}});
  const first = await call("artifact_read",{id});
  assert.equal(first.files["index.html"],"hello");
  assert.equal(first.source,path.join(root,"index.html"));
  const binary = {encoding:"base64",data:"AP+A"};
  const args = {source:first.source,title:first.title,description:first.description,icon:first.icon,label:"Assets",
    files:{"index.html":"hello","image.png":binary,"doc.pdf":binary,"face.woff2":binary},expectedVersion:first.version};
  await call("artifact_publish",args);
  assert.deepEqual((await call("artifact_read",{id})).files,args.files);
  await call("artifact_restore",{id,version:2,expectedVersion:2});
  assert.deepEqual((await call("artifact_read",{id})).files,args.files);
});

test("the WSL tool bridge uses the desktop profile and preserves caller scope", async t => {
  const {artifactTools} = await import("./tools-wsl.mjs");
  const root = mkdtempSync(path.join(tmpdir(),"chronos-artifact-host-"));
  const vars = {CHRONOS_ARTIFACT_WINDOWS_NODE:process.execPath,
    CHRONOS_ARTIFACT_WINDOWS_RUNNER:path.join(import.meta.dirname,"wsl-host.mjs"), CHRONOS_ARTIFACT_WINDOWS_HOME:root};
  const previous = Object.fromEntries(Object.keys(vars).map(key => [key,process.env[key]]));
  Object.assign(process.env,vars);
  t.after(() => {
    for (const [key,value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(root,{recursive:true,force:true});
  });
  const publish = artifactTools.find(tool => tool.name === "artifact_publish");
  const context = {allowFile:false,environmentId:"local",threadId:"thread-one"};
  // The host receives the native path after wslpath translation.
  const args = {source:path.join(root,"source.html"),title:"Host page",description:"Host.",icon:"book",label:"First"};
  const input = {...args,files:{"index.html":"first"}};
  // Exercise the actual Windows/Electron host boundary on its target platform.
  if (process.platform !== "win32") {t.skip("Windows host");return;}
  await assert.rejects(publish.run(args,context),/index.html/);
  const created = await publish.run(input,context);
  assert.equal(created.version,1);
  const db = (await import("./store.mjs")).openArtifacts(root);
  try {assert.deepEqual({...db.origin(created.id)},{environmentId:"local",threadId:"thread-one"});}
  finally {db.close();}
  await assert.rejects(publish.run({...input,id:created.id,expectedVersion:0},context),/версия — 1/);
});

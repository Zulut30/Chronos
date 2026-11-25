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

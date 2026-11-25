import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { handleRequest } from "../studio-service/mcp.mjs";

test("MCP discovers tools lazily, publishes and reads", async () => {
  const root = mkdtempSync(path.join(tmpdir(),"chronos-artifact-mcp-"));
  process.env.CHRONOS_SERVICES_DATA = root;
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
  assert.equal((await call("artifact_read",{id})).files["index.html"],"hello");
});

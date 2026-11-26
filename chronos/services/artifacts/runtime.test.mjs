import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {openArtifacts} from "./store.mjs";
import {allowed,resource} from "./policy.mjs";

test("two artifact clients share only the selected document namespace; batch rolls back",async t => {
  const home = mkdtempSync(path.join(tmpdir(),"chronos-artifact-runtime-"));
  const a=openArtifacts(home), b=openArtifacts(home);
  t.after(()=>{a.close();b.close();rmSync(home,{recursive:true,force:true});});
  const input={source:path.join(home,"one"),title:"План задач",icon:"📒",description:"Задачи",label:"Первый вариант",files:{"index.html":"<main>1</main>"},capabilities:["db"]};
  const {id}=a.publish(input), other=a.publish({...input,source:path.join(home,"two")}).id;
  const entry={collection:"tasks",key:"a",value:{done:false}};
  a.documents(id,"set",entry);
  b.documents(id,"update",{...entry,value:{title:"Сборка"}});
  assert.deepEqual(a.documents(id,"query",{collection:"tasks",where:{done:false}}),[{key:"a",value:{done:false,title:"Сборка"}}]);
  assert.equal(b.documents(other,"get",entry),null);
  assert.throws(()=>a.documents(id,"batch",{operations:[{...entry,method:"delete"},{...entry,method:"update"}]}));
  assert.equal(b.documents(id,"get",entry).title,"Сборка");
  const url="chronos-artifact://"+id+"/index.html";
  const response=resource(a,id,url);
  assert.equal(await response.text(),input.files["index.html"]);
  assert.match(response.headers.get("Content-Security-Policy"),/default-src 'none'/);
  assert.equal(resource(a,other,url).status,403);
  assert.equal(allowed(new URL("https://cdn.jsdelivr.net/x"),id,false),true);
  for (const url of ["https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.js",
    "https://unpkg.com/@scope/lib@1.0.0/app.js","https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"])
    assert.equal(allowed(new URL(url),id,false,"script"),true);
  for (const url of ["https://unpkg.com/lib@latest/app.js","https://cdn.jsdelivr.net/npm/lib@3/app.js"])
    assert.equal(allowed(new URL(url),id,false,"script"),false);
  for(const u of ["https://cdn.jsdelivr.net.example.org","http://127.0.0.1:4520","file:///foo"]) assert.equal(allowed(new URL(u),id,false),false);
  assert.equal(allowed(new URL("https://unpkg.com"),id,true),false);
  assert.throws(()=>a.remove(id,9));
  assert.deepEqual(a.remove(id,1),{deleted:true});
  assert.throws(()=>a.documents(id,"list",{collection:"tasks"}));
});

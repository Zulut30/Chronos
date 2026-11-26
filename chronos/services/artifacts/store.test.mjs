import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openArtifacts } from "./store.mjs";

test("independent clients preserve history and reject stale writes", t => {
  const home = mkdtempSync(path.join(tmpdir(), "chronos-artifacts-"));
  const a = openArtifacts(home), b = openArtifacts(home);
  t.after(() => { a.close(); b.close(); rmSync(home, { recursive: true, force: true }); });
  const input = { source: path.join(home, "demo.html"), title: "Demo page", icon: "book",
    description: "A demo.", label: "First", files: { "index.html": "one" } };
  const { id } = a.publish(input);
  assert.throws(() => b.publish(input), /Версия изменилась/);
  b.publish({ ...input, title:"Renamed page", expectedVersion: 1, files: { "index.html": "two" } });
  assert.equal(a.read(id,1).files["index.html"].toString(), "one");
  assert.equal(a.read(id).files["index.html"].toString(), "two");
  assert.equal(a.history(id).length, 2);
  assert.throws(() => a.restore(id,1,1), /Версия изменилась/);
  assert.equal(a.restore(id,1,2).version,3);
  assert.equal(b.read(id).files["index.html"].toString(),"one");
  assert.equal(b.read(id,2).files["index.html"].toString(),"two");
  assert.equal(b.list()[0].title,input.title);
  assert.deepEqual(b.titles(id).sort(),["Demo page","Renamed page"]);
  assert.throws(() => a.publish({ ...input, files: { ...input.files, "../x": "bad" } }), /имя файла/);
});

test("stable id, source thread, soft delete and versioned thumbnail survive reopening", t => {
  const home=mkdtempSync(path.join(tmpdir(),"chronos-library-"));
  t.after(()=>rmSync(home,{recursive:true,force:true}));
  let db=openArtifacts(home);
  const data={source:path.join(home,"plan.html"),title:"План недели",description:"Расписание на неделю.",icon:"calendar",label:"Начало",files:{"index.html":"A"}};
  const origin={threadId:"source",environmentId:"local"};
  const {id}=db.publish(data,origin);
  db.documents(id,"set",{collection:"settings",key:"a",value:{saved:true}});
  db.saveThumbnail(id,1,Buffer.from("picture"));
  assert.equal(Buffer.from(db.thumbnail(id,1)).toString(),"picture");
  const update={...data,source:undefined,id,expectedVersion:1,files:{"index.html":"B"}};
  assert.equal(db.publish(update).version,2);
  assert.throws(()=>db.publish(update),/Актуальная версия — 2/);
  assert.equal(db.thumbnail(id,2),undefined);
  db.remove(id,2);
  assert.deepEqual(db.list(),[]);
  assert.throws(()=>db.read(id));
  db.close();db=openArtifacts(home);
  try {
    assert.equal(db.list(true)[0].id,id);
    assert.equal(db.recover(id),true);
    assert.deepEqual(db.origin(id),origin);
    assert.equal(db.documents(id,"get",{collection:"settings",key:"a"}).saved,true);
    assert.equal(Buffer.from(db.file(id,"index.html",1)).toString(),"A");
    assert.equal(db.restore(id,1,2).version,3);
  } finally {db.close();}
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// An old reader pins the log while the writer repeatedly updates the same rows.
// Compare only the retained journal limit; allow identical PASSIVE checkpoints.
function sample(limitMiB) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chronos-wal-"));
  const file = path.join(root,"sample.db");
  const db = new DatabaseSync(file), reader = new DatabaseSync(file), checkpoint = new DatabaseSync(file);
  try {
    db.exec(`PRAGMA auto_vacuum=INCREMENTAL; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
      PRAGMA journal_size_limit=${limitMiB*1048576}; PRAGMA wal_autocheckpoint=10000;
      CREATE TABLE events(id INTEGER PRIMARY KEY, version INTEGER, payload BLOB);
      BEGIN; WITH RECURSIVE ids(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM ids WHERE n<1024)
      INSERT INTO events SELECT n,0,zeroblob(3000) FROM ids; COMMIT;`);
    checkpoint.exec("PRAGMA wal_checkpoint(PASSIVE)");
    reader.exec("BEGIN");
    const sum = "SELECT sum(version) AS n FROM events";
    assert.equal(reader.prepare(sum).get().n, 0);
    const start = performance.now(), cpu = process.cpuUsage();
    const commits = [];
    for (let batch=0;batch<20;batch++) {
      const tick = performance.now();
      db.exec("BEGIN; UPDATE events SET version=version+1; COMMIT");
      commits.push(performance.now()-tick);
      checkpoint.exec("PRAGMA wal_checkpoint(PASSIVE)");
    }
    const size = () => fs.statSync(file+"-wal").size/1048576;
    const pinnedMiB = size();
    assert.equal(reader.prepare(sum).get().n, 0);
    reader.exec("COMMIT");
    const progress = checkpoint.prepare("PRAGMA wal_checkpoint(PASSIVE)").get();
    assert.equal(progress.log, progress.checkpointed);
    db.exec("UPDATE events SET version=version+1 WHERE id=1");
    const retainedMiB = size(), usage = process.cpuUsage(cpu);
    const elapsedMs = performance.now()-start;
    assert.equal(db.prepare(sum).get().n, 20481);
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    console.log(JSON.stringify({limitMiB,pinnedMiB,retainedMiB,elapsedMs,cpuMs:(usage.user+usage.system)/1000,
      commitP95Ms:commits.sort((a,b)=>a-b)[18]}));
  } finally {
    reader.close(); checkpoint.close(); db.close();
    fs.rmSync(root,{recursive:true,force:true});
  }
}
for (const limit of [128,32,32,128,128,32]) sample(limit);

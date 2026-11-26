import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { documentDatabase } from "./documents.mjs";
import { decodeFiles } from "./assets.mjs";
import { declared } from "./policy.mjs";

export function openArtifacts(home = process.env.CHRONOS_HOME || path.join(homedir(), ".chronos")) {
  const dir = path.join(home, "userdata", "artifacts");
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, "artifacts.sqlite"));
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS artifacts(id TEXT PRIMARY KEY, source TEXT UNIQUE NOT NULL, pinned INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS versions(id TEXT REFERENCES artifacts ON DELETE CASCADE, version INTEGER,
      metadata TEXT NOT NULL, PRIMARY KEY(id,version));
    CREATE TABLE IF NOT EXISTS files(id TEXT, version INTEGER, name TEXT, content BLOB NOT NULL,
      PRIMARY KEY(id,version,name), FOREIGN KEY(id,version) REFERENCES versions ON DELETE CASCADE);`);
  // Keep the original tables readable when upgrading an existing profile.
  db.exec(`CREATE TABLE IF NOT EXISTS library(id TEXT PRIMARY KEY REFERENCES artifacts ON DELETE CASCADE,
    updated INTEGER NOT NULL DEFAULT 0, trashed INTEGER NOT NULL DEFAULT 0,
    thread TEXT, environment TEXT, thumbnail BLOB, snapshotVersion INTEGER);
    INSERT OR IGNORE INTO library(id) SELECT id FROM artifacts;`);
  function active(id) {
    const row = db.prepare("SELECT thread,environment FROM library WHERE id=? AND trashed=0").get(id);
    if (!row) throw Error("Артефакт не найден или находится в корзине");
    return row;
  }
  function checkVersion(id, expected) {
    const current = head(id);
    if (current !== expected) throw Error(`Версия изменилась. Актуальная версия — ${current}. Прочитайте её и объедините правки.`);
  }
  const head = id => db.prepare("SELECT max(version) AS version FROM versions WHERE id=?").get(id).version ?? 0;
  function publish({ id: target, source, expectedVersion = 0, title, description, icon, label, files, capabilities = [] }, origin = {}) {
    if ((!target || source !== undefined) && (typeof source !== "string" || !path.isAbsolute(source))) throw Error("Укажите абсолютный путь к исходному файлу");
    if (typeof title !== "string" || !/^\S+(?:\s+\S+){1,3}$/u.test(title) ||
        ![description, label, icon].every(value => typeof value === "string" && value.trim()) ||
        /\s/u.test(icon)) throw Error("Укажите название из 2–4 слов, описание, значок и подпись версии");
    capabilities = declared(capabilities);
    const {decoded,binaryFiles} = decodeFiles(files);
    db.exec("BEGIN IMMEDIATE");
    try {
      const key = source && path.normalize(source);
      const id = target ?? db.prepare("SELECT id FROM artifacts WHERE source=?").get(key)?.id ?? randomUUID();
      const current = head(id);
      if (target || current) active(id);
      checkVersion(id, expectedVersion);
      if (!current) {
        db.prepare("INSERT INTO artifacts(id,source) VALUES (?,?)").run(id,key);
        db.prepare("INSERT INTO library(id,thread,environment) VALUES (?,?,?)")
          .run(id,origin.threadId ?? null,origin.environmentId ?? null);
      }
      db.prepare("UPDATE library SET updated=?,thumbnail=NULL,snapshotVersion=NULL WHERE id=?").run(Date.now(),id);
      const version = current + 1;
      db.prepare("INSERT INTO versions VALUES (?,?,?)").run(id,version,JSON.stringify({title,description,icon,label,capabilities,binaryFiles}));
      const insert = db.prepare("INSERT INTO files VALUES (?,?,?,?)");
      for (const [name, content] of decoded) insert.run(id, version, name, content);
      db.exec("COMMIT");
      return { id, version };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return {
    publish,
    documents: documentDatabase(db),
    origin(id) {
      const {thread,environment} = active(id);
      return thread && environment ? {threadId:thread,environmentId:environment} : null;
    },
    metadata(id, version = head(id)) {
      active(id);
      const row = db.prepare("SELECT metadata,version FROM versions WHERE id=? AND version=?").get(id,version);
      if (!row) throw Error("Артефакт не найден");
      return {capabilities:[],...JSON.parse(row.metadata),version:row.version};
    },
    file(id,name,version = head(id)) {
      return db.prepare("SELECT content FROM files WHERE id=? AND version=? AND name=? AND EXISTS(SELECT 1 FROM library WHERE id=? AND trashed=0)").get(id,version,name,id)?.content;
    },
    read(id, version = head(id)) {
      active(id);
      const row = db.prepare("SELECT a.source,v.metadata FROM artifacts a JOIN versions v ON v.id=a.id WHERE a.id=? AND v.version=?").get(id,version);
      if (!row) throw Error("Версия не найдена");
      return { id, source: row.source, version, ...JSON.parse(row.metadata), files: Object.fromEntries(
        db.prepare("SELECT name,content FROM files WHERE id=? AND version=?").all(id,version)
          .map(file => [file.name, Buffer.from(file.content)])) };
    },
    history: id => db.prepare("SELECT version,json_extract(metadata,'$.label') AS label FROM versions WHERE id=? ORDER BY version DESC").all(id),
    list: (trash = false) => db.prepare(`SELECT a.id,a.source,a.pinned,v.version,l.updated,
      json_extract(v.metadata,'$.title') AS title, json_extract(v.metadata,'$.description') AS description,
      json_extract(v.metadata,'$.icon') AS icon FROM artifacts a JOIN library l ON l.id=a.id JOIN versions v ON v.id=a.id
      WHERE l.trashed=? AND v.version=(SELECT max(version) FROM versions WHERE id=a.id)
      ORDER BY pinned DESC,l.updated DESC,v.rowid DESC`).all(trash ? 1 : 0),
    restore(id, version, expectedVersion) {
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw Error("Укажите номер текущей версии");
      db.exec("BEGIN IMMEDIATE");
      try {
        active(id);
        checkVersion(id,expectedVersion);
        const next = expectedVersion + 1;
        const copied = db.prepare("INSERT INTO versions SELECT id,?,json_set(metadata,'$.label',?) FROM versions WHERE id=? AND version=?")
          .run(next,`Восстановлена версия ${version}`,id,version);
        if (!copied.changes) throw Error("Версия не найдена");
        db.prepare("INSERT INTO files SELECT id,?,name,content FROM files WHERE id=? AND version=?").run(next,id,version);
        db.prepare("UPDATE library SET updated=?,thumbnail=NULL,snapshotVersion=NULL WHERE id=?").run(Date.now(),id);
        db.exec("COMMIT");
        return {id, version:next};
      } catch (e) {db.exec("ROLLBACK");throw e;}
    },
    pin: (id, pinned) => db.prepare("UPDATE artifacts SET pinned=? WHERE id=?").run(pinned ? 1 : 0,id).changes,
    remove(id, expectedVersion) {
      const result = db.prepare("UPDATE library SET trashed=1 WHERE id=? AND trashed=0 AND (SELECT max(version) FROM versions WHERE id=?)=?").run(id,id,expectedVersion);
      if (!result.changes) throw Error("Версия изменилась. Обновите список");
      return { deleted: true };
    },
    recover(id) {
      return Boolean(db.prepare("UPDATE library SET trashed=0 WHERE id=? AND trashed=1").run(id).changes);
    },
    thumbnail(id,version) {
      return db.prepare("SELECT thumbnail FROM library WHERE id=? AND trashed=0 AND snapshotVersion=?").get(id,version)?.thumbnail;
    },
    saveThumbnail(id,version,bytes) {
      db.prepare("UPDATE library SET thumbnail=?,snapshotVersion=? WHERE id=? AND trashed=0 AND (SELECT max(version) FROM versions WHERE id=?)=?")
        .run(bytes,version,id,id,version);
    },
    close: () => db.close(),
  };
}

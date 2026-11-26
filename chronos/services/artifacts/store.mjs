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
  const head = id => db.prepare("SELECT max(version) AS version FROM versions WHERE id=?").get(id).version ?? 0;
  function publish({ source, expectedVersion = 0, title, description, icon, label, files, capabilities = [] }) {
    if (typeof source !== "string" || !path.isAbsolute(source)) throw Error("Укажите абсолютный путь к исходному файлу");
    if (typeof title !== "string" || !/^\S+(?:\s+\S+){1,3}$/u.test(title) ||
        ![description, label, icon].every(value => typeof value === "string" && value.trim()) ||
        /\s/u.test(icon)) throw Error("Укажите название из 2–4 слов, описание, значок и подпись версии");
    capabilities = declared(capabilities);
    const {decoded,binaryFiles} = decodeFiles(files);
    db.exec("BEGIN IMMEDIATE");
    try {
      const key = path.normalize(source);
      const id = db.prepare("SELECT id FROM artifacts WHERE source=?").get(key)?.id ?? randomUUID();
      const current = head(id);
      if (current !== expectedVersion) throw Error("Версия изменилась. Прочитайте последнюю версию и объедините изменения");
      if (!current) db.prepare("INSERT INTO artifacts(id,source) VALUES (?,?)").run(id,key);
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
    titles: id => db.prepare("SELECT DISTINCT json_extract(metadata,'$.title') AS title FROM versions WHERE id=?").all(id).map(row => row.title),
    metadata(id) {
      const row = db.prepare("SELECT metadata,version FROM versions WHERE id=? ORDER BY version DESC LIMIT 1").get(id);
      if (!row) throw Error("Артефакт не найден");
      return {capabilities:[],...JSON.parse(row.metadata),version:row.version};
    },
    file(id,name) {
      return db.prepare("SELECT content FROM files WHERE id=? AND version=(SELECT max(version) FROM versions WHERE id=?) AND name=?").get(id,id,name)?.content;
    },
    read(id, version = head(id)) {
      const row = db.prepare("SELECT a.source,v.metadata FROM artifacts a JOIN versions v ON v.id=a.id WHERE a.id=? AND v.version=?").get(id,version);
      if (!row) throw Error("Версия не найдена");
      return { id, source: row.source, version, ...JSON.parse(row.metadata), files: Object.fromEntries(
        db.prepare("SELECT name,content FROM files WHERE id=? AND version=?").all(id,version)
          .map(file => [file.name, Buffer.from(file.content)])) };
    },
    history: id => db.prepare("SELECT version,json_extract(metadata,'$.label') AS label FROM versions WHERE id=? ORDER BY version DESC").all(id),
    list: () => db.prepare(`SELECT a.id,a.source,a.pinned,v.version,
      json_extract(v.metadata,'$.title') AS title, json_extract(v.metadata,'$.description') AS description,
      json_extract(v.metadata,'$.icon') AS icon FROM artifacts a JOIN versions v ON v.id=a.id
      WHERE v.version=(SELECT max(version) FROM versions WHERE id=a.id)
      ORDER BY pinned DESC,title COLLATE NOCASE,a.id`).all(),
    restore(id, version, expectedVersion) {
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw Error("Укажите номер текущей версии");
      db.exec("BEGIN IMMEDIATE");
      try {
        if (head(id) !== expectedVersion) throw Error("Версия изменилась. Откройте галерею заново и повторите восстановление");
        const next = expectedVersion + 1;
        const copied = db.prepare("INSERT INTO versions SELECT id,?,json_set(metadata,'$.label',?) FROM versions WHERE id=? AND version=?")
          .run(next,`Восстановлена версия ${version}`,id,version);
        if (!copied.changes) throw Error("Версия не найдена");
        db.prepare("INSERT INTO files SELECT id,?,name,content FROM files WHERE id=? AND version=?").run(next,id,version);
        db.exec("COMMIT");
        return {id, version:next};
      } catch (e) {db.exec("ROLLBACK");throw e;}
    },
    pin: (id, pinned) => db.prepare("UPDATE artifacts SET pinned=? WHERE id=?").run(pinned ? 1 : 0,id).changes,
    remove(id, expectedVersion) {
      const result = db.prepare("DELETE FROM artifacts WHERE id=? AND (SELECT max(version) FROM versions WHERE id=?)=?").run(id,id,expectedVersion);
      if (!result.changes) throw Error("Версия изменилась. Обновите список");
      return { deleted: true };
    },
    close: () => db.close(),
  };
}

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

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
  function publish({ source, expectedVersion = 0, title, description, icon, label, files }) {
    if (!path.isAbsolute(source)) throw Error("Expected absolute source path");
    if (typeof title !== "string" || !/^\S+(?:\s+\S+){1,3}$/u.test(title) ||
        ![description, label, icon].every(value => typeof value === "string" && value.trim()) ||
        /\s/u.test(icon)) throw Error("Invalid metadata");
    const entries = Object.entries(files);
    if (!Object.hasOwn(files, "index.html") || entries.length > 255) throw Error("Invalid file map");
    for (const [name, content] of entries) {
      if (name.split("/").some(part => !part || part === "." || part === "..") || /[\\:#?%\x00-\x1f]/u.test(name))
        throw Error("Invalid file name");
      const html = /\.html?$/i.test(name);
      if ((typeof content !== "string" && !(content instanceof Uint8Array)) ||
          Buffer.byteLength(content) > (html ? 16 : 15) * 1024 ** 2) throw Error("Invalid file content");
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      const key = path.normalize(source);
      const id = db.prepare("SELECT id FROM artifacts WHERE source=?").get(key)?.id ?? randomUUID();
      const current = head(id);
      if (current !== expectedVersion) throw Error("Version conflict: read and merge");
      if (!current) db.prepare("INSERT INTO artifacts(id,source) VALUES (?,?)").run(id,key);
      const version = current + 1;
      db.prepare("INSERT INTO versions VALUES (?,?,?)").run(id,version,JSON.stringify({title,description,icon,label}));
      const insert = db.prepare("INSERT INTO files VALUES (?,?,?,?)");
      for (const [name, content] of entries) insert.run(id, version, name, Buffer.from(content));
      db.exec("COMMIT");
      return { id, version };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return {
    publish,
    read(id, version = head(id)) {
      const row = db.prepare("SELECT metadata FROM versions WHERE id=? AND version=?").get(id,version);
      if (!row) throw Error("Unknown version");
      return { id, version, ...JSON.parse(row.metadata), files: Object.fromEntries(
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
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw Error("Expected current version");
      const snapshot = this.read(id, version);
      const { source } = db.prepare("SELECT source FROM artifacts WHERE id=?").get(id);
      return publish({ ...snapshot, source, expectedVersion, label: `Восстановлена версия ${version}` });
    },
    pin: (id, pinned) => db.prepare("UPDATE artifacts SET pinned=? WHERE id=?").run(pinned ? 1 : 0,id).changes,
    close: () => db.close(),
  };
}

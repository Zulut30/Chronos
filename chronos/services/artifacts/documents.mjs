const writes = new Set(["set","update","delete"]);
export const documentMethods = ["get","list","query",...writes,"batch"];
function key(value) {
  if (typeof value !== "string" || !value.length || value.length > 256) throw Error("Некорректный ключ");
  return value;
}
function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Ожидается объект JSON");
  return value;
}
export function documentDatabase(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS documents(artifact TEXT REFERENCES artifacts(id) ON DELETE CASCADE,
    collection TEXT, key TEXT, value TEXT NOT NULL, PRIMARY KEY(artifact,collection,key))`);
  const get = db.prepare("SELECT value FROM documents WHERE artifact=? AND collection=? AND key=?");
  const page = db.prepare("SELECT key,value FROM documents WHERE artifact=? AND collection=? AND key>? ORDER BY key");
  const save = db.prepare("INSERT INTO documents VALUES(?,?,?,?) ON CONFLICT(artifact,collection,key) DO UPDATE SET value=excluded.value");
  const remove = db.prepare("DELETE FROM documents WHERE artifact=? AND collection=? AND key=?");
  function apply(id, method, args) {
    const collection = key(args.collection);
    if (method === "list" || method === "query") {
      const limit = args.limit ?? 100;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw Error("Лимит от 1 до 500");
      const where = method === "query" ? Object.entries(object(args.where)) : [];
      if (where.some(([,v])=>v !== null && !["string","number","boolean"].includes(typeof v))) throw Error("Фильтр принимает скалярные значения");
      const results = [];
      for (const row of page.iterate(id,collection,args.after === undefined ? "" : key(args.after))) {
        const value = JSON.parse(row.value);
        if (where.every(([k,v])=>Object.hasOwn(value,k) && value[k] === v)) results.push({key:row.key,value});
        if (results.length === limit) break;
      }
      return results;
    }
    const k = key(args.key);
    if (method === "delete") return Boolean(remove.run(id,collection,k).changes);
    const old = method === "set" ? undefined : get.get(id,collection,k);
    if (method === "get") return old ? JSON.parse(old.value) : null;
    if (!writes.has(method)) throw Error("Неизвестная операция БД");
    if (method === "update" && !old) throw Error("Документ не найден");
    const data = object(args.value);
    const serialized = JSON.stringify(old ? {...JSON.parse(old.value),...data} : data);
    if (Buffer.byteLength(serialized) > 1024 * 1024) throw Error("Документ больше 1 МБ");
    save.run(id,collection,k,serialized);
    return true;
  }
  return (id, method, args) => {
    if (!documentMethods.includes(method)) throw Error("Неизвестная операция БД");
    if (!db.prepare("SELECT 1 FROM artifacts WHERE id=?").get(id)) throw Error("Артефакт не найден");
    if (method !== "batch" && !writes.has(method)) return apply(id,method,args);
    db.exec("BEGIN IMMEDIATE");
    try {
      let result;
      if (method === "batch") {
        if (!Array.isArray(args.operations) || args.operations.length > 256) throw Error("До 256 операций в пакете");
        result = args.operations.map(op => {
          if (!writes.has(op.method)) throw Error("Ожидается операция записи");
          return apply(id,op.method,op);
        });
      } else result = apply(id,method,args);
      db.exec("COMMIT");
      return result;
    } catch (e) {db.exec("ROLLBACK");throw e;}
  };
}

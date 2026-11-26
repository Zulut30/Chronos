// @effect-diagnostics nodeBuiltinImport:off -- The shared-home guard runs synchronously before Electron or any Effect layer opens user data.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

const conflict =
  "Данные T3 заняты. Завершите Olympus/T3 и его локальный сервер, затем снова откройте Chronos.";

export function prepareT3DataHome(
  home: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): void {
  const original = NodePath.join(home, ".t3");
  const configured = env.CHRONOS_HOME?.trim();
  // A marker survives shortcuts, login and updater restarts. Explicit sandboxes take precedence.
  if (!configured && !NodeFS.existsSync(NodePath.join(home, ".chronos", "use-t3-data"))) return;
  const selected = NodePath.resolve(configured || original);
  if (!NodeFS.existsSync(original) || !NodeFS.existsSync(selected)) {
    if (!configured) throw new Error("Каталог данных T3 отсутствует.");
    return;
  }
  const same = (a: string, b: string) => {
    const left = NodeFS.realpathSync.native(a);
    const right = NodeFS.realpathSync.native(b);
    return platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
  };
  const dbPath = (dir: string) => NodePath.join(dir, "userdata", "statev2.sqlite");
  if (
    !same(original, selected) &&
    !(
      NodeFS.existsSync(dbPath(selected)) &&
      NodeFS.existsSync(dbPath(original)) &&
      same(dbPath(selected), dbPath(original))
    )
  )
    return;

  if (platform !== "win32") throw new Error("Переход на данные T3 подготовлен только для Windows.");
  if (!NodeFS.statSync(dbPath(original)).isFile()) throw new Error("База данных T3 отсутствует.");
  const processes = NodeChildProcess.execFileSync(
    NodePath.join(env.SystemRoot || "C:\\Windows", "System32", "tasklist.exe"),
    ["/FO", "CSV", "/NH"],
    { encoding: "utf8", windowsHide: true, timeout: 10000 },
  );
  if (!processes.includes('","'))
    throw new Error("Не удалось проверить запущенные процессы Windows.");
  if (/^"(?:T3 Code(?: \([^)]+\))?|t3code|Olympus)\.exe",/im.test(processes))
    throw new Error(conflict);
  // Both server versions hold an exclusive transaction in this separate rollback-journal database.
  // The server itself also acquires it atomically before opening statev2.sqlite.
  const owner = NodePath.join(original, "userdata", "server-owner.sqlite");
  if (NodeFS.existsSync(owner)) {
    const lock = new NodeSqlite.DatabaseSync(owner, { readOnly: true });
    try {
      lock.prepare("SELECT count(*) FROM sqlite_schema").get();
    } catch {
      throw new Error(conflict);
    } finally {
      lock.close();
    }
  }
  env.CHRONOS_HOME = original;
}

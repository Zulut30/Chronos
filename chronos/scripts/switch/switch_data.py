"""Private on-disk migration. Copy encrypted data as an opaque, same-user Windows profile."""
import contextlib
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile

import tomlkit


class Conflict(Exception):
    pass


def require(condition, message):
    if not condition:
        raise Conflict(message)


def linked(path):
    return bool(path.lstat().st_file_attributes & 0x400) if os.name == "nt" else path.is_symlink()


def check_path(path):
    for parent in (path, *path.parents):
        if parent.exists() or parent.is_symlink():
            require(not linked(parent), "Junction или ссылка на пути операции. Требуется ручная проверка.")


def files(root):
    check_path(root)
    def propagate(error):
        raise error
    for folder, dirs, names in os.walk(root, onerror=propagate):
        folder = Path(folder)
        for name in dirs:
            require(not linked(folder / name), "В каталоге есть ссылка или junction.")
        for name in names:
            path = folder / name
            require(not linked(path), "В каталоге есть ссылка.")
            yield path


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").digest()


def copy_verified(source, target):
    check_path(source)
    check_path(target)
    require(not target.exists(), "Место для копии уже занято.")
    if source.is_dir():
        # copytree preserves empty directories. Reject junctions before following any subtree.
        for _ in files(source):
            pass
        shutil.copytree(source, target)
        for path in files(source):
            require(digest(path) == digest(target / path.relative_to(source)), "Копия изменилась при проверке.")
    else:
        shutil.copy2(source, target)
        require(digest(source) == digest(target), "Контрольная сумма копии не совпала.")


def atomic(path, content):
    check_path(path)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temp:
        staging = Path(temp.name)
        try:
            temp.write(content)
            temp.flush()
            os.fsync(temp.fileno())
        except BaseException:
            temp.close()
            staging.unlink(missing_ok=True)
            raise
    try:
        os.replace(staging, path)
    finally:
        staging.unlink(missing_ok=True)


def migration(userdata):
    dbpath = userdata / "statev2.sqlite"
    with contextlib.closing(sqlite3.connect(dbpath.as_uri() + "?mode=ro", uri=True, timeout=2)) as db:
        return db.execute("SELECT MAX(migration_id) FROM effect_sql_migrations").fetchone()[0]


def relocate_studio_state(source, destination, *, copied_paths_only=False):
    state = destination / "state.json"
    if not state.is_file():
        return
    document = json.loads(state.read_bytes())

    def relocate(raw):
        p = Path(raw)
        if p.is_absolute() and p.is_relative_to(source):
            return str(destination / p.relative_to(source))
        return None if copied_paths_only else raw

    recent = []
    for entry in document.get("recent", []):
        path = relocate(entry["path"])
        if path is not None:
            recent.append({**entry, "path": path, "dir": str(Path(path).parent)})
    document["recent"] = recent
    document["customDirs"] = [value for p in document.get("customDirs", []) if (value := relocate(p)) is not None]
    atomic(state, json.dumps(document, ensure_ascii=False).encode("utf-8"))


def check_unowned(userdata):
    owner = userdata / "server-owner.sqlite"
    if owner.exists():
        try:
            with contextlib.closing(sqlite3.connect(owner.as_uri() + "?mode=ro", uri=True, timeout=0)) as db:
                db.execute("SELECT count(*) FROM sqlite_schema").fetchone()
        except sqlite3.Error:
            raise Conflict("Профиль занят сервером T3 или файл блокировки недоступен.") from None


STDIO = {"oly-tasks": "tasks-service/mcp.mjs", "oly-skills": "skills-manager/mcp.mjs",
         "openrouter": "openrouter-service/server.mjs"}
HTTP = ("oly-web", "t3-studio")


def agent_files(home):
    paths = [home / ".claude.json", Path(os.environ.get("CODEX_HOME") or home / ".codex") / "config.toml",
            home / ".cursor/mcp.json", home / ".gemini/settings.json",
            home / ".gemini/antigravity/mcp_config.json", home / ".copilot/mcp-config.json"]
    # User-configured agent homes are often junctions to a second disk. Pin their actual files.
    return list(dict.fromkeys(path.resolve() for path in paths))


def agent_edit(path, t3, resources):
    check_path(path)
    raw = path.read_bytes()
    if not raw.strip():
        return None, 0, 0
    is_toml = path.suffix == ".toml"
    doc = (tomlkit.parse if is_toml else json.loads)(raw.decode("utf-8-sig"))
    tables = [doc.get("mcp_servers" if is_toml else "mcpServers", {})]
    if path.name == ".claude.json":
        tables.extend(p.get("mcpServers", {}) for p in doc.get("projects", {}).values())
    changed = kept = 0
    for table in tables:
        for name in HTTP:
            if name in table:
                url = table[name].get("url", "")
                require(url in [f"http://{host}:4524/mcp/{name}" for host in ("localhost", "127.0.0.1")],
                        "Нестандартный адрес HTTP MCP. Проверьте регистрацию.")
                kept += 1
        for name, rel in STDIO.items():
            if name not in table:
                continue
            item = table[name]
            cmd = Path(item.get("command", ""))
            args = item.get("args", [])
            if args == [str(resources / rel)]:
                continue
            legacy = t3 / "caches/t3-customizations/olympus-hub/lazy"
            require(cmd.parent == legacy and cmd.name in ("olympus-mcp-lazy.exe", "olympus-mcp-lazy-v2.exe")
                    and len(args) == 2 and args[0] == name, "Незнакомая команда stdio MCP. Перенос остановлен.")
            node = Path(args[1])
            require(node.is_absolute() and node.name.lower() == "node.exe" and node.is_file(),
                    "Для stdio MCP не найден зарегистрированный Node.")
            require((resources / rel).is_file(), "В пакете отсутствует скрипт stdio MCP.")
            item["command"] = str(node)
            item["args"] = [str(resources / rel)]
            env = item.setdefault("env", {})
            env["CHRONOS_T3_HOME"] = str(t3)
            env["CHRONOS_SERVICES_DATA"] = str(t3)
            changed += 1
    if not changed:
        return None, changed, kept
    encoded = tomlkit.dumps(doc) if is_toml else json.dumps(doc, ensure_ascii=False, indent=2) + "\n"
    return encoded.encode("utf-8"), changed, kept

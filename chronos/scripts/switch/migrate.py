# /// script
# requires-python = ">=3.11"
# dependencies = ["psutil==7.1.3", "tomlkit==0.13.3"]
# ///
"""Run from a Windows user terminal. No secret content or raw OS errors go to the log."""
import argparse
import contextlib
import datetime
import json
import msvcrt
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

from switch_data import (Conflict, agent_edit, agent_files, atomic, check_path, check_unowned,
                         copy_verified, digest, files, migration, relocate_studio_state, require)
from windows_processes import (SERVICES, check_tunnels, close_desktop, cold_database_files, desktop_processes, launch,
                               legacy_services, listeners, stop_legacy, wait_for_backend, wait_for_services)

WARNING = "Миграции 4774 → 5209 необратимы. Откат восстанавливает резервную копию."
HOME = Path.home()
T3 = HOME / ".t3"
CONTROL = HOME / ".chronos"
APPDATA = Path(os.environ["APPDATA"])
LOCAL = Path(os.environ["LOCALAPPDATA"])
SOURCE = APPDATA / "t3code-v2"
PROFILE = APPDATA / "Chronos"
OLYMPUS = LOCAL / "Programs/t3code/T3 Code (Nightly).exe"
CHRONOS = LOCAL / "Programs/chronos/Chronos.exe"
STARTUP = APPDATA / "Microsoft/Windows/Start Menu/Programs/Startup"
MARKER = CONTROL / "use-t3-data"
ACTIVE = CONTROL / "switch-transaction.json"
STORES = ("tasks", "prompts", "olympus-hub", "mcp-manager", "files-service", "studio-service",
          "integrations-service", "caches/skills-registry.json", "caches/skills-trash", "caches/prompts-trash")
IMPORT = ("studio-service/data", "files-service/ssh-targets.json", "integrations-service/state.json")
LOG = None


def say(message):
    print(message, flush=True)
    if LOG is not None:
        with LOG.open("a", encoding="utf-8") as stream:
            stream.write(f"{datetime.datetime.now().isoformat(timespec='seconds')} {message}\n")


def save(doc):
    atomic(ACTIVE, json.dumps(doc).encode())


def validate_executable():
    marker = CHRONOS.parent / "resources/chronos-services/switch-protocol.json"
    require(OLYMPUS.is_file() and CHRONOS.is_file(), "Не найдены оба настольных приложения.")
    require(marker.is_file() and json.loads(marker.read_bytes()) == {"windowsDataSwitch": 1},
            "Выбранный пакет Chronos ещё не поддерживает защищённый переход.")


def changes():
    return {p: agent_edit(p, T3, CHRONOS.parent / "resources/chronos-services")
            for p in agent_files(HOME) if p.is_file()}


def preflight(strict):
    print(WARNING, flush=True)
    for path in (T3, CONTROL, SOURCE, PROFILE, STARTUP, ACTIVE, MARKER):
        check_path(path)
    require(SOURCE.is_dir() and (SOURCE / "Local Storage").is_dir() and (SOURCE / "Local State").is_file(),
            "Не найден полный профиль Electron Olympus.")
    sizes = []
    for label, root in [("userdata", T3 / "userdata"), ("Electron Olympus", SOURCE), ("Electron Chronos", PROFILE)]:
        size = sum(p.stat().st_size for p in files(root)) if root.is_dir() else 0
        sizes.append(size)
        say(f"{label} — {size / 2**30:.2f} ГиБ")
    extra = sum(sum(p.stat().st_size for p in files(T3 / rel)) if (T3 / rel).is_dir()
                else (T3 / rel).stat().st_size for rel in STORES if (T3 / rel).exists())
    free = shutil.disk_usage(HOME).free
    require(sum(sizes) + sizes[0] + sizes[1] + extra + 2**30 < free, "Мало места для копии и восстановления.")
    say(f"Свободно {free / 2**30:.1f} ГиБ. Миграция {migration(T3 / 'userdata')}.")
    errors = []
    desktop = desktop_processes(OLYMPUS)
    try:
        check_unowned(T3 / "userdata")
        say("Блокировка базы свободна.")
    except Conflict:
        owned = False
        if desktop:
            try:
                runtime = json.loads((T3 / "userdata/server-runtime.json").read_bytes())
                owned = runtime["pid"] in {p.pid for p in desktop} | {
                    child.pid for p in desktop for child in p.children(recursive=True)}
            except (FileNotFoundError, ValueError, KeyError):
                pass
        if owned:
            say("Блокировку держит локальный сервер Olympus. Переключение дождётся его выхода.")
        else:
            errors.append("Блокировку держит отдельный сервер T3 или файл недоступен.")
    for probe in [validate_executable, lambda: check_tunnels(desktop),
                  lambda: legacy_services(T3), lambda: require(not desktop_processes(CHRONOS), "Открыт Chronos."),
                  lambda: require(not MARKER.exists() and not ACTIVE.exists(), "Уже есть операция перехода."),
                  lambda: require(not os.environ.get("CHRONOS_HOME"), "Удалите CHRONOS_HOME из окружения запуска.")]:
        try:
            probe()
        except Conflict as exc:
            errors.append(str(exc))
    edits = changes()
    say(f"MCP — {sum(x[1] for x in edits.values())} stdio для переноса, {sum(x[2] for x in edits.values())} HTTP сохраняются.")
    auto = sum((STARTUP / vbs).is_file() for _, vbs in SERVICES.values())
    say(f"В резервную копию перейдут {auto} записей автозагрузки, userdata, профили и данные служб.")
    for err in errors:
        say(err)
    if strict:
        require(not errors, "Предварительная проверка не пройдена. Приложения продолжают работу.")
    return not errors


def before_write():
    require(not desktop_processes(CHRONOS) and not desktop_processes(OLYMPUS), "Профиль повторно открыт.")
    check_unowned(T3 / "userdata")


def stash(path, dest):
    check_path(path)
    check_path(dest)
    if path.exists():
        require(not dest.exists(), "Каталог сохранения уже занят.")
        dest.parent.mkdir(parents=True, exist_ok=True)
        path.rename(dest)


def enroll(b, doc, key, target):
    doc["assets"][key] = target.exists()
    if target.exists():
        dest = b / "original" / key
        dest.parent.mkdir(parents=True, exist_ok=True)
        copy_verified(target, dest)


def switch():
    preflight(True)
    active_services = legacy_services(T3)
    # The 4774 SSH finalizer can terminate a remotely owned serve on graceful quit.
    name = "switch-" + datetime.datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    b = CONTROL / "backups" / name
    check_path(b)
    b.mkdir(parents=True)
    doc = {"backup": name, "phase": "backing-up", "schema": migration(T3 / "userdata"), "assets": {}, "agents": [],
           "autostart": [], "running": sorted(active_services)}
    save(doc)
    close_desktop(OLYMPUS)
    before_write()
    say("Olympus закрыт. Создаётся и сверяется резервная копия вместе с WAL.")
    with cold_database_files(T3 / "userdata"):
        enroll(b, doc, "userdata", T3 / "userdata")
    enroll(b, doc, "olympus-profile", SOURCE)
    enroll(b, doc, "chronos-profile", PROFILE)
    for i, (path, (new, _, _)) in enumerate(changes().items()):
        if new is None:
            continue
        key = f"agent-{i}"
        enroll(b, doc, key, path)
        after = b / "prepared" / key
        after.parent.mkdir(exist_ok=True)
        atomic(after, new)
        doc["agents"].append([key, str(path)])
    for _, vbs in SERVICES.values():
        if (STARTUP / vbs).exists():
            doc["autostart"].append(vbs)
    for rel in IMPORT:
        require(not (T3 / rel).exists() or not (T3 / "caches/t3-customizations" / rel).exists(),
                "Есть две версии данных встроенного сервиса. Требуется сверка.")
    before_write()
    doc["phase"] = "services"
    save(doc)
    for vbs in doc["autostart"]:
        stash(STARTUP / vbs, b / "startup" / vbs)
    stop_legacy(T3, active_services)
    for rel in STORES:
        enroll(b, doc, "stores/" + rel, T3 / rel)
    before_write()
    doc["phase"] = "applying"
    save(doc)
    stash(PROFILE, b / "previous-profile")
    copy_verified(b / "original/olympus-profile", PROFILE)
    for rel in IMPORT:
        old, new = T3 / "caches/t3-customizations" / rel, T3 / rel
        if old.exists():
            new.parent.mkdir(parents=True, exist_ok=True)
            copy_verified(old, new)
            if rel == "studio-service/data":
                relocate_studio_state(old, new)
    for key, raw in doc["agents"]:
        target = Path(raw)
        require(digest(target) == digest(b / "original" / key), "Конфигурация агента изменилась во время перехода.")
        atomic(target, (b / "prepared" / key).read_bytes())
    atomic(MARKER, b"1\n")
    before_write()
    require(not listeners(), "Порты встроенных сервисов заняты.")
    desktop = launch(CHRONOS, ["--verify-t3-profile"])
    wait_for_services(CHRONOS)
    wait_for_backend(desktop, T3 / "userdata", doc["schema"])
    doc["phase"] = "switched"
    save(doc)
    say("Chronos открыл базу и запустил семь встроенных сервисов. Резервная копия сохранена.")


def recover_asset(b, key, target, existed):
    # A completed rename is the durable intent record. Retrying cannot stash the restored copy.
    saved = b / "post-switch" / key
    stamp = b / "restored" / key
    if stamp.is_file():
        return
    if not saved.exists():
        stash(target, saved)
    elif target.exists():
        # A previous copy might have stopped midway. Preserve it instead of merging trees.
        stash(target, b / "incomplete" / str(time.time_ns()))
    if existed:
        target.parent.mkdir(parents=True, exist_ok=True)
        copy_verified(b / "original" / key, target)
    stamp.parent.mkdir(parents=True, exist_ok=True)
    atomic(stamp, b"1")


def rollback():
    require(ACTIVE.is_file(), "Нет журнала активного перехода.")
    doc = json.loads(ACTIVE.read_bytes())
    name = doc["backup"]
    import re
    require(re.fullmatch(r"switch-\d{8}-\d{6}-\d{6}", name), "Некорректная запись резервной копии.")
    b = CONTROL / "backups" / name
    check_path(b)
    phase = doc["phase"]
    if phase == "backing-up" and desktop_processes(OLYMPUS):
        stash(ACTIVE, b / "completed-rollback.json")
        say("Olympus продолжает работу. Переход завершён до изменения данных.")
        return
    require(not desktop_processes(OLYMPUS), "Сначала завершите Olympus.")
    require(phase in ("backing-up", "services", "applying", "switched", "restored"), "Неизвестная фаза перехода.")
    if phase in ("applying", "switched"):
        close_desktop(CHRONOS)
        before_write()
        require(not listeners(), "Порты сервисов заняты. Не удалось подтвердить остановку Chronos.")
        for key, raw in doc["agents"]:
            target = Path(raw)
            require(target in agent_files(HOME), "Неизвестный путь конфигурации агента.")
            restore_agent(b, key, target)
        if MARKER.exists():
            stash(MARKER, b / "post-switch-marker")
        for key, path in [("userdata", T3 / "userdata"), ("olympus-profile", SOURCE), ("chronos-profile", PROFILE)]:
            recover_asset(b, key, path, doc["assets"][key])
        for rel in STORES:
            recover_asset(b, "stores/" + rel, T3 / rel, doc["assets"]["stores/" + rel])
        require(migration(T3 / "userdata") == doc["schema"], "Не совпала версия восстановленной базы.")
        doc["phase"] = "restored"
        save(doc)
    if phase != "backing-up":
        for vbs in doc["autostart"]:
            require(vbs in {name for _, name in SERVICES.values()}, "Неизвестная запись автозагрузки.")
            source = b / "startup" / vbs
            if source.exists():
                require(not (STARTUP / vbs).exists(), "Файл автозагрузки уже существует.")
                stash(source, STARTUP / vbs)
        running = legacy_services(T3)
        for port in doc["running"]:
            if port not in running:
                vbs = STARTUP / SERVICES[port][1]
                require(vbs.is_file(), "Нет VBS для запуска прежней службы.")
                launch(Path(os.environ["SystemRoot"]) / "System32/wscript.exe", [vbs])
        end = time.monotonic() + 45
        while not set(doc["running"]).issubset(legacy_services(T3)):
            require(time.monotonic() < end, "Не все службы Olympus вернулись. Повторите откат.")
            time.sleep(1)
    launch(OLYMPUS)
    say("Восстановлена конфигурация Olympus. Дана команда запуска приложения.")
    stash(ACTIVE, b / "completed-rollback.json")


def restore_agent(b, key, path):
    import tomlkit
    parse = tomlkit.parse if path.suffix == ".toml" else json.loads
    original = (b / "original" / key).read_bytes()
    applied = (b / "prepared" / key).read_bytes()
    current = path.read_bytes()
    if current == original:
        return
    if current == applied:
        atomic(path, original)
        return
    # Claude can record unrelated session state while Chronos is in use.
    decode = lambda value: parse(value.decode("utf-8-sig"))
    old, new, live = map(decode, (original, applied, current))
    field = "mcp_servers" if path.suffix == ".toml" else "mcpServers"
    def restore(first, second, now):
        for entry, item in first.get(field, {}).items():
            if item == second.get(field, {}).get(entry):
                continue
            present = now.get(field, {}).get(entry)
            require(present in (item, second[field][entry]), "Во время работы изменена регистрация MCP.")
            now[field][entry] = item
    restore(old, new, live)
    for project, item in old.get("projects", {}).items():
        restore(item, new["projects"][project], live.get("projects", {}).get(project, {}))
    output = tomlkit.dumps(live) if path.suffix == ".toml" else json.dumps(live, ensure_ascii=False, indent=2) + "\n"
    require(path.read_bytes() == current, "Конфигурация агента изменилась при восстановлении.")
    atomic(path, output.encode("utf-8"))


@contextlib.contextmanager
def operation_lock():
    path = CONTROL / "switch-operation.lock"
    check_path(path)
    with path.open("a+b") as stream:
        stream.seek(0)
        try:
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            raise Conflict("Уже выполняется другая операция перехода.") from None
        try:
            yield
        finally:
            stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["preflight", "switch", "rollback"])
    parser.add_argument("--chronos", type=Path, default=CHRONOS)
    args = parser.parse_args()
    CHRONOS = args.chronos.resolve()
    try:
        if args.action == "preflight":
            sys.exit(0 if preflight(False) else 2)
        check_path(CONTROL)
        CONTROL.mkdir(exist_ok=True)
        with operation_lock():
            folder = CONTROL / "logs"
            check_path(folder)
            folder.mkdir(exist_ok=True)
            LOG = folder / f"{args.action}-{datetime.datetime.now():%Y%m%d-%H%M%S}.log"
            say(WARNING)
            (switch if args.action == "switch" else rollback)()
    except Conflict as exc:
        say(str(exc))
        sys.exit(2)
    except Exception as exc:
        # Paths, worker output and configuration values must not enter the switch log.
        say(f"Операция остановлена ({type(exc).__name__}). Проверьте состояние через preflight.")
        sys.exit(1)

"""Ownership checks for the seven legacy listeners and the two desktop windows."""
import contextlib
import ctypes
from ctypes import wintypes
import http.client
import json
import os
from pathlib import Path
import subprocess
import time

import psutil

from switch_data import Conflict, require

SERVICES = {
    4517: ("skills-manager", "t3-skills-manager.vbs"),
    4518: ("tasks-service", "t3-tasks-service.vbs"),
    4519: ("files-service", "t3-files-service.vbs"),
    4520: ("studio-service", "t3-studio.vbs"),
    4522: ("integrations-service", "t3-integrations.vbs"),
    4523: ("mcp-manager", "t3-mcp-manager.vbs"),
    4524: ("olympus-hub", "t3-olympus-hub.vbs"),
}


def listeners():
    return {c.laddr.port: c.pid for c in psutil.net_connections("tcp")
            if c.status == psutil.CONN_LISTEN and c.laddr.port in SERVICES}


@contextlib.contextmanager
def cold_database_files(userdata):
    # Sharing flags apply to existing and future writers. Keep all cold SQLite files readable
    # for backup while denying write/delete access, including to a newly opened SQLite client.
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    create = kernel.CreateFileW
    create.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID,
                       wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    create.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handles = []
    try:
        for name in ("statev2.sqlite", "statev2.sqlite-wal", "statev2.sqlite-shm", "statev2.sqlite-journal"):
            handle = create(str(userdata / name), 0x80000000, 1, None, 3, 0x80, None)
            if handle == ctypes.c_void_p(-1).value:
                if name != "statev2.sqlite" and ctypes.get_last_error() == 2:
                    continue
                raise Conflict("Файл SQLite открыт для записи или недоступен. Холодная копия остановлена.")
            handles.append(handle)
        yield
    finally:
        for handle in handles:
            kernel.CloseHandle(handle)


def legacy_services(t3):
    result = {}
    for port, pid in listeners().items():
        require(pid, "Не удалось определить владельца порта сервисов.")
        proc = psutil.Process(pid)
        args = proc.cmdline()
        expected = t3 / "caches/t3-customizations" / SERVICES[port][0] / "server.mjs"
        require(proc.name().lower() == "node.exe" and len(args) == 2 and
                (Path(proc.cwd()) / args[1]).resolve() == expected.resolve(),
                f"Порт {port} занят другим процессом.")
        result[port] = proc
    return result


def desktop_processes(exe):
    return [p for p in psutil.process_iter(["exe"]) if p.info["exe"] and Path(p.info["exe"]) == exe]


def check_tunnels(processes):
    for process in processes:
        for child in process.children(recursive=True):
            try:
                if child.name().lower() == "ssh.exe" and any(a == "-N" or a.startswith("-L") for a in child.cmdline()):
                    raise Conflict("Открыт SSH-тоннель Olympus. Выход может прервать сервер и агентов.")
            except psutil.NoSuchProcess:
                continue


def close_desktop(exe):
    processes = desktop_processes(exe)
    if not processes:
        return
    check_tunnels(processes)
    pids = {p.pid for p in processes}
    user32 = ctypes.windll.user32
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user32.IsWindowVisible.argtypes = [wintypes.HWND]

    @callback_type
    def close_window(hwnd, _):
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value in pids and user32.IsWindowVisible(hwnd):
            user32.PostMessageW(hwnd, 0x10, 0, 0)
        return True

    user32.EnumWindows(close_window, 0)
    _, alive = psutil.wait_procs(processes, timeout=30)
    require(not alive and not desktop_processes(exe), "Приложение остаётся в трее. Завершите через меню «Выход».")


def stop_legacy(t3, recorded):
    fresh = legacy_services(t3)
    for port, proc in fresh.items():
        require(port in recorded and proc == recorded[port], "Владелец порта изменился.")
    for proc in fresh.values():
        proc.terminate()  # psutil validates process creation time on Windows.
    _, alive = psutil.wait_procs(list(fresh.values()), timeout=10)
    require(not alive and not listeners(), "Сервис не освободил свой порт.")


def launch(exe, args=()):
    env = os.environ.copy()
    for name in ("CHRONOS_HOME", "T3CODE_HOME", "ELECTRON_RUN_AS_NODE", "CHRONOS_SSH_CLI_SOURCE",
                 "CHRONOS_SWITCH_REHEARSAL"):
        env.pop(name, None)
    return subprocess.Popen([str(exe), *map(str, args)], env=env, cwd=exe.parent,
                            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS)


def wait_for_services(exe):
    end = time.monotonic() + 90
    while time.monotonic() < end:
        current = listeners()
        if current.keys() == SERVICES.keys():
            host = Path("resources/chronos-services/host.mjs")
            for pid in set(current.values()):
                p = psutil.Process(pid)
                require(Path(p.exe()) == exe and any(Path(a) == exe.parent / host for a in p.cmdline()),
                        "Сервис после переключения запущен сторонним процессом.")
            return
        time.sleep(1)
    raise Conflict("Chronos не занял все семь портов. Доступен откат.")


def wait_for_backend(desktop, userdata, previous_schema):
    from switch_data import migration
    expected = (userdata / "environment-id").read_text("utf-8-sig").strip()
    owner = psutil.Process(desktop.pid)
    end = time.monotonic() + 300
    while time.monotonic() < end:
        require(owner.is_running(), "Chronos завершился до готовности сервера. Доступен откат.")
        try:
            runtime = json.loads((userdata / "server-runtime.json").read_bytes())
            if runtime["pid"] in {child.pid for child in owner.children(recursive=True)}:
                with contextlib.closing(http.client.HTTPConnection("127.0.0.1", runtime["port"], timeout=2)) as connection:
                    connection.request("GET", "/.well-known/t3/environment")
                    reply = connection.getresponse()
                    if reply.status == 200:
                        data = json.loads(reply.read(65536))
                        if data.get("environmentId") == expected and data.get("databaseMigration", 0) > previous_schema:
                            if data["databaseMigration"] == migration(userdata):
                                return
        except (FileNotFoundError, OSError, ValueError, KeyError, http.client.HTTPException):
            pass
        time.sleep(1)
    raise Conflict("Сервер Chronos не подтвердил готовность мигрированной базы. Доступен откат.")

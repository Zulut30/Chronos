"""Ownership checks for the seven legacy listeners and the two desktop windows."""
import ctypes
from ctypes import wintypes
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

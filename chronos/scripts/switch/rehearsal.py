"""Prepare a disposable snapshot before its first packaged startup. Never used by switch or rollback."""
import contextlib
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time

from switch_data import check_path, require


def owned_snapshot(path):
    path = Path(path).resolve(strict=True)
    require(path.parent == Path(tempfile.gettempdir()).resolve() and path.name.startswith("chronos-switch-snapshot-"),
            "Expected a private switch snapshot directory.")
    check_path(path)
    return path


def private_env(root):
    fake, temp = root / "user", root / "tmp"
    env = {k: os.environ[k] for k in ("SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "SystemDrive", "ProgramFiles",
           "ProgramFiles(x86)", "ProgramW6432", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE") if k in os.environ}
    env.update(USERPROFILE=str(fake), HOME=str(fake), APPDATA=str(fake/"Roaming"), LOCALAPPDATA=str(fake/"Local"),
               TMP=str(temp), TEMP=str(temp), CHRONOS_HOME=str(root/"run"), T3CODE_HOME=str(root/"run"),
               CHRONOS_SWITCH_REHEARSAL="1", T3CODE_PORT="28531", T3CODE_DISABLE_AUTO_UPDATE="true",
               T3CODE_TELEMETRY_ENABLED="false", DO_NOT_TRACK="1", CI="1", CODEX_HOME=str(fake/".codex"),
               CLAUDE_CONFIG_DIR=str(fake/".claude"), GIT_CONFIG_NOSYSTEM="1", GIT_TERMINAL_PROMPT="0",
               PATH=os.pathsep.join((str(fake / "bin"),str(Path(env["SystemRoot"])/"System32"),env["SystemRoot"])),
               HTTP_PROXY="http://127.0.0.1:9", HTTPS_PROXY="http://127.0.0.1:9", ALL_PROXY="http://127.0.0.1:9",
               NO_PROXY="localhost,127.0.0.1,::1", NODE_USE_ENV_PROXY="1", T3CODE_RELAY_URL="https://127.0.0.1:9")
    return env


def isolate_database(path, work):
    with contextlib.closing(sqlite3.connect(path)) as db, db:
        def count(table):
            return db.execute("SELECT count(*) FROM " + table).fetchone()[0]

        before = {table: count(table) for table in ("projection_projects", "orchestration_v2_projection_threads",
                                                     "orchestration_v2_projection_messages")}
        for table in ("auth_sessions", "auth_pairing_links", "auth_connect_devices", "peer_environment_links",
                      "scheduled_task_webhook_pending", "scheduled_task_webhook_deliveries",
                      "scheduled_task_webhook_relay_deliveries", "orchestration_v2_thread_launch_workflows",
                      "orchestration_v2_effect_outbox", "provider_session_runtime",
                      "orchestration_v2_projection_provider_session_bindings"):
            db.execute("DELETE FROM " + table)
            require(count(table) == 0, "A copied queue or authorization record remains")
        db.execute("UPDATE scheduled_tasks SET enabled=0, next_run_at=NULL, webhook_token=NULL, webhook_secret=NULL")
        stamp = "strftime('%Y-%m-%dT%H:%M:%fZ','now')"
        for suffix, status in [("runs","interrupted"),("run_attempts","interrupted"),("nodes","interrupted"),
                               ("provider_turns","interrupted"),("turn_items","interrupted"),("subagents","interrupted"),
                               ("provider_sessions","stopped"),("provider_threads","idle"),("runtime_requests","expired")]:
            table = "orchestration_v2_projection_" + suffix
            columns = {row[1] for row in db.execute("PRAGMA table_info(" + table + ")")}
            changes = "status=?, payload_json=json_set(payload_json,'$.status',?)"
            if "completed_at" in columns:
                changes = "status=?, completed_at="+stamp+", payload_json=json_set(payload_json,'$.status',?,'$.completedAt',"+stamp+")"
            db.execute("UPDATE "+table+" SET "+changes+" WHERE status IN "
                       "('starting','running','queued','pending','waiting','active','ready','streaming','in_progress','blocked')",
                       (status, status))
        db.execute("UPDATE orchestration_v2_projection_threads SET active_provider_thread_id=NULL, "
                   "payload_json=json_set(payload_json,'$.activeProviderThreadId',NULL,'$.worktreePath',NULL,"
                   "'$.linkedPullRequest',NULL,'$.branchPullRequest',NULL)")
        for i, (project,) in enumerate(db.execute("select project_id from projection_projects").fetchall()):
            folder = work / f"project-{i}"
            folder.mkdir(parents=True)
            db.execute("UPDATE projection_projects SET workspace_root=?, auto_pull=0, scripts_json='[]' WHERE project_id=?",
                       (str(folder),project))
        require(db.execute("SELECT count(*) FROM scheduled_tasks WHERE enabled").fetchone()[0] == 0,
                "Copied schedule remains enabled")
        require(not db.execute("SELECT 1 FROM orchestration_v2_projection_runs WHERE status NOT IN "
                               "('completed','cancelled','failed','interrupted','rolled_back') LIMIT 1").fetchone(),
                "An unfinished copied run remains")
        require(all(count(t) == n for t, n in before.items()), "History count changed during isolation")
        return before


def copy_live_storage(source, dest):
    # LOCK is held by Chromium. Copy a stable generation and let the offline reader recover its own LOCK.
    names = lambda: {p.name: (p.stat().st_size, p.stat().st_mtime_ns) for p in source.iterdir()
                     if p.is_file() and p.name not in ("LOCK", "LOG", "LOG.old")}
    for attempt in range(5):
        current = names()
        out = dest / f"generation-{attempt}"
        out.mkdir()
        try:
            for name in current:
                shutil.copyfile(source/name, out/name)
            if current == names():
                return out
        except FileNotFoundError:
            pass
    raise RuntimeError("No stable LevelDB generation")


def prepare_rehearsal(snapshot, electron):
    root = owned_snapshot(snapshot)
    require(not (root / "run").exists(), "Use a fresh snapshot for preparation")
    original = root / "userdata"
    target = root / "run/userdata"
    target.mkdir(parents=True)
    env = private_env(root)
    for key in ("HOME","APPDATA","LOCALAPPDATA","TEMP","CLAUDE_CONFIG_DIR","CODEX_HOME"):
        Path(env[key]).mkdir(parents=True, exist_ok=True)
    # Start with an allowlist. Cloud/clerk secrets, device identities, peer and SSH catalogs, logs,
    # browser partitions, executable providers and shell-environment caches stay in the cold snapshot.
    for name in ("statev2.sqlite","themes","keybindings.json"):
        if (original / name).is_dir():
            shutil.copytree(original / name, target / name)
        elif (original / name).is_file():
            shutil.copy2(original / name, target / name)
    counts = isolate_database(target / "statev2.sqlite", root / "workspaces")
    settings = json.loads((original/"settings.json").read_text("utf-8-sig"))
    drivers = ("codex","claudeAgent","cursor","grok","muse","pi","opencode","antigravity","kiro","fx")
    disabled = {key: {"driver":key, "enabled":False} for key in drivers}
    for key,value in settings.get("providerInstances",{}).items():
        disabled[key] = {"driver": value.get("driver",key), "enabled":False}
    for key in ("codex","claudeAgent"):
        disabled[key]["config"] = {"binaryPath":str(root/"no-provider.exe")}
    settings = {k:v for k,v in settings.items() if k in ("responseStreamingMode","theme","locale","fontSize")}
    settings.update(providerInstances=disabled, automaticGitFetchInterval=0, backgroundActivityProfile="battery-saver")
    (target/"settings.json").write_text(json.dumps(settings), encoding="utf8")
    desktop = {"localEnvironmentEnabled":True,"wslBackendEnabled":False,"wslOnly":False,"serverExposure":"local-only"}
    (target/"desktop-settings.json").write_text(json.dumps(desktop), encoding="utf8")
    clients = json.loads((original/"client-settings.json").read_text("utf-8-sig"))
    presentation = {k:v for k,v in clients.items() if k.lower().startswith(("theme","font","appearance","locale","color"))}
    (target/"client-settings.json").write_text(json.dumps(presentation), encoding="utf8")

    t3 = Path.home()/".t3"
    for rel, dst in (("tasks","tasks"),("prompts","prompts"),
                     ("caches/t3-customizations/studio-service/data","studio-service/data")):
        source, dest = t3 / rel, root/"run"/dst
        if source.is_dir():
            dest.parent.mkdir(parents=True,exist_ok=True)
            shutil.copytree(source,dest)
    skills = Path.home()/".agents/skills"
    for folder in skills.iterdir() if skills.is_dir() else ():
        entry = folder/"SKILL.md"
        if entry.is_file():
            dest = root/"user/.agents/skills"/folder.name
            dest.mkdir(parents=True)
            shutil.copyfile(entry,dest/"SKILL.md")

    fixture = root / "fixture"
    profile = fixture / "source-profile"
    profile.mkdir(parents=True)
    (fixture/"offline-fixture").touch()
    live_profile = Path(os.environ["APPDATA"])/"t3code-v2"
    source = copy_live_storage(live_profile/"Local Storage/leveldb", fixture)
    (profile/"Local Storage").mkdir()
    source.rename(profile/"Local Storage/leveldb")
    shutil.copyfile(live_profile/"Local State", profile/"Local State")
    shutil.copyfile(original/"connection-catalog.json",fixture/"connection-catalog.json")
    # Stock Electron runs only the fixture, with no provider, server, Clerk bridge or renderer network access.
    env["CHRONOS_SWITCH_FIXTURE"] = str(fixture)
    subprocess.run([str(electron),str(Path(__file__).with_name("rehearsal-profile.cjs")),
                    "--proxy-server=127.0.0.1:9","--disable-background-networking"],env=env,
                   cwd=fixture,check=True,timeout=70,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    result = json.loads((fixture/"counts.json").read_bytes())
    require(result["decryptable"], "Copied profile verification failed")
    dest = root/"user/Roaming/Chronos"
    dest.mkdir(parents=True)
    shutil.copytree(fixture/"clean-storage/Local Storage",dest/"Local Storage")
    # The packaged runtime gets a new profile key and never receives the original catalog or cookies.
    (root/"prepared.json").write_text(json.dumps({"history":counts,"profile":result}), encoding="utf8")
    return counts, result


def start_package(snapshot, executable):
    root = owned_snapshot(snapshot)
    require((root/"prepared.json").is_file(), "Copy is not prepared")
    require(executable.is_relative_to(Path(tempfile.gettempdir()).resolve()), "Use the portable package under TEMP.")
    require(executable.is_file() and (executable.parent/"resources/chronos-services/switch-protocol.json").is_file(),
            "Not a switch-capable package")
    for port in (9,28531,29437,24517,24518,24519,24520,24522,24523,24524):
        with socket.socket() as sock:
            require(sock.connect_ex(("127.0.0.1",port)) != 0, "A rehearsal port is occupied")
    env = private_env(root)
    require(not (root/"run/userdata/connection-catalog.json").exists() and not (root/"run/userdata/secrets").exists(),
            "Expected a first launch without saved identities")
    proc = subprocess.Popen([str(executable),"--remote-debugging-port=29437","--remote-debugging-address=127.0.0.1",
                             "--proxy-server=127.0.0.1:9","--disable-background-networking"],
                            env=env,cwd=root,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    print("rehearsal_pid",proc.pid,flush=True)


if __name__ == "__main__":
    command, root, executable = sys.argv[1:]
    if command == "prepare":
        print(prepare_rehearsal(root,Path(executable).resolve()))
    elif command == "start":
        start_package(root,Path(executable).resolve())
    else:
        raise SystemExit(2)

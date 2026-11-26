"""Take an online, pinned, read-only SQLite snapshot of Olympus in a new TEMP directory."""
import contextlib
import os
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile
import time


def snapshot(source, dest):
    user = source / "userdata"
    target = dest / "userdata"
    size = sum(entry.stat().st_size for root, dirs, names in os.walk(user)
               for entry in (Path(root) / n for n in names) if entry.is_file())
    if shutil.disk_usage(dest).free < size * 2 + 2**30:
        raise RuntimeError("Insufficient free space")
    target.mkdir()
    started = time.monotonic()
    path = user / "statev2.sqlite"
    with contextlib.closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as src:
        # Without this read transaction sqlite3_backup can restart indefinitely on a busy WAL.
        src.execute("BEGIN")
        src.execute("SELECT count(*) FROM sqlite_schema").fetchone()
        with contextlib.closing(sqlite3.connect(target / path.name)) as dst:
            src.backup(dst, pages=2048, sleep=.05)
        src.rollback()
    print("sqlite_backup_seconds", round(time.monotonic() - started), flush=True)
    skip = {"statev2.sqlite", "statev2.sqlite-wal", "statev2.sqlite-shm", "server-runtime.json",
            "server-owner.sqlite", "server-owner.sqlite-journal"}
    skipped = {}
    for folder, dirs, names in os.walk(user):
        root = Path(folder)
        out = target / root.relative_to(user)
        out.mkdir(exist_ok=True)
        for n in dirs + names:
            if (root / n).is_symlink() or (getattr((root / n), "is_junction", lambda: False)()):
                raise RuntimeError("Snapshot contains a link")
        for name in names:
            if root == user and name in skip:
                continue
            try:
                shutil.copy2(root / name, out / name)
            except OSError as error:
                group = root.relative_to(user).parts[:1]
                group = group[0] if group and group[0] in {"logs", "server-browser", "browser-artifacts", "antigravity-tmp"} else "other"
                skipped[group] = skipped.get(group, 0) + 1
                if group == "other":
                    raise RuntimeError("Required user data could not be copied") from error
    print("skipped_volatile_files", skipped, "total_seconds", round(time.monotonic() - started), flush=True)


if __name__ == "__main__":
    dest = Path(tempfile.mkdtemp(prefix="chronos-switch-snapshot-"))
    print(dest, flush=True)
    snapshot(Path.home() / ".t3", dest)

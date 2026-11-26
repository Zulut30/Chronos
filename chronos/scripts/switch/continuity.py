
"""Verify data for the same Windows account without starting any provider, CLI, SSH or relay."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

from switch_data import check_path, digest, require


def inventory(userdata):
    settings = json.loads((userdata / "settings.json").read_bytes())
    slots = settings.get("providerInstances", {})
    require(isinstance(slots, dict), "Некорректный список провайдеров.")
    return {
        "configured": len(slots),
        "providerSecrets": len(list((userdata / "secrets").glob("provider-*.bin"))),
        "accountData": (userdata / "providers").is_dir(),
        "catalog": (userdata / "connection-catalog.json").is_file(),
        "sshConfig": (Path.home() / ".ssh/config").is_file(),
    }


def verify_files(original, candidate, original_profile, candidate_profile):
    # The cold-backup copier already verifies every byte under providers/ (including per-account homes).
    # Compare active settings, account references, selections and protected slots independently as well.
    for name in ("settings.json", "connection-catalog.json", "client-settings.json", "desktop-settings.json", "saved-environments.json",
                 "ssh-launcher-id", "model-manifest.json", "shell-environment-cache.json"):
        left, right = original / name, candidate / name
        require(left.is_file() == right.is_file() and (not left.is_file() or digest(left) == digest(right)),
                "Не совпали настройки, модели или данные SSH.")
    secrets = [set(p.name for p in (data / "secrets").glob("*.bin")) for data in (original, candidate)]
    require(secrets[0] == secrets[1] and all(digest(original / "secrets" / n) == digest(candidate / "secrets" / n)
                                             for n in secrets[0]), "Различаются файлы хранилища секретов.")
    def profile_key(profile):
        return json.loads((profile / "Local State").read_bytes()).get("os_crypt", {}).get("encrypted_key")
    key = profile_key(original_profile)
    require(key and key == profile_key(candidate_profile), "Ключи профилей Electron различаются.")
    return {"serverSecretFiles": len(secrets[0]),
            "providerSecretFiles": sum(name.startswith("provider-") for name in secrets[0])}


def verify_profile(executable, original, candidate, original_profile, candidate_profile):
    slots = verify_files(original, candidate, original_profile, candidate_profile)
    with tempfile.TemporaryDirectory(prefix="chronos-switch-audit-") as tmp:
        root = Path(tmp)
        check_path(root)
        profile = root / "profile"
        profile.mkdir()
        shutil.copyfile(candidate_profile / "Local State", profile / "Local State")
        for name, source in (("original", original), ("candidate", candidate)):
            dest = root / name
            dest.mkdir()
            for filename in ("settings.json", "connection-catalog.json"):
                shutil.copyfile(source / filename, dest / filename)
        # The standalone packaged entry never constructs the application's runtime layers.
        env = {k: os.environ[k] for k in ("SystemRoot", "WINDIR", "COMSPEC", "SystemDrive", "PATH",
                                         "TEMP", "TMP", "PATHEXT") if k in os.environ}
        fake = root / "user"
        env.update(CHRONOS_SWITCH_AUDIT=str(root), HOME=str(fake), USERPROFILE=str(fake),
                   APPDATA=str(fake / "Roaming"), LOCALAPPDATA=str(fake / "Local"),
                   HTTP_PROXY="http://127.0.0.1:9", HTTPS_PROXY="http://127.0.0.1:9",
                   ALL_PROXY="http://127.0.0.1:9", DO_NOT_TRACK="1")
        for k in ("HOME", "APPDATA", "LOCALAPPDATA"):
            Path(env[k]).mkdir(parents=True, exist_ok=True)
        done = subprocess.run([str(executable), "--audit-switch-copy", "--proxy-server=127.0.0.1:9",
                               "--disable-background-networking", "--disable-crash-reporter"],
                              env=env, cwd=root, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                              stderr=subprocess.DEVNULL, timeout=90)
        require(done.returncode == 0 and (root / "result.json").is_file(),
                "Пакет не подтвердил список провайдеров, адреса SSH или защищённый каталог.")
        stats = json.loads((root / "result.json").read_bytes())
        require(stats.get("settingsMatch") and stats.get("savedAddressesMatch") and stats.get("decryptable"),
                "Проверка профиля не пройдена.")
        return {**stats, **slots}

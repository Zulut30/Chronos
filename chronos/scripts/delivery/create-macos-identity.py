"""Provision the release identity from a maintainer workstation. Prints only its public fingerprint."""
import argparse
import base64
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile

REPO = "Zulut30/Chronos"
SECRET = "CHRONOS_MAC_SIGNING_IDENTITY"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--rotate", action="store_true", help="replace the existing release identity")
args = parser.parse_args()
existing = subprocess.check_output(["gh", "secret", "list", "-R", REPO, "--json", "name"])
if any(secret["name"] == SECRET for secret in json.loads(existing)) and not args.rotate:
    parser.error("Release identity already exists. Rotation requires a new manual installation.")

with tempfile.TemporaryDirectory(prefix="chronos-sign-") as directory:
    work = Path(directory)
    password = secrets.token_urlsafe(48)
    (work / "password").write_text(password, encoding="ascii")
    (work / "key-password").write_text(secrets.token_urlsafe(48), encoding="ascii")
    openssl = os.environ.get("OPENSSL", "openssl")
    def run(*options):
        return subprocess.check_output([openssl, *options], cwd=work, stderr=subprocess.PIPE)
    run("req", "-x509", "-newkey", "rsa:3072", "-sha256", "-days", "7300",
        "-subj", "/CN=Chronos Desktop Updates", "-addext", "basicConstraints=critical,CA:FALSE",
        "-addext", "keyUsage=critical,digitalSignature", "-addext", "extendedKeyUsage=critical,codeSigning",
        "-keyout", "key.pem", "-out", "cert.pem", "-passout", "file:key-password")
    run("pkcs12", "-export", "-inkey", "key.pem", "-in", "cert.pem", "-name", "Chronos Desktop Updates",
        "-keypbe", "PBE-SHA1-3DES", "-certpbe", "PBE-SHA1-3DES", "-macalg", "sha1",
        "-passin", "file:key-password", "-passout", "file:password", "-out", "identity.p12")
    fingerprint = run("x509", "-in", "cert.pem", "-noout", "-fingerprint", "-sha1").decode().strip()
    payload = json.dumps({"p12": base64.b64encode((work / "identity.p12").read_bytes()).decode(),
                          "password": password}).encode()
    subprocess.run(["gh", "secret", "set", SECRET, "-R", REPO], input=payload, check=True)
    print(fingerprint.split("=")[1].replace(":", "").upper())

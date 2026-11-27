#!/usr/bin/env bash
# Run only on the disposable GitHub macOS packager. Trust is limited to code signing.
set -euo pipefail
umask 077
: "${RUNNER_TEMP:?}"
chain="$RUNNER_TEMP/chronos-signing.keychain-db"
cert="$RUNNER_TEMP/chronos-signing.pem"
if [[ "${1:-}" == clean ]]; then
  # The runner VM owns the admin-domain code-signing trust and is destroyed after this job.
  # The update and Keychain rehearsal runs on a separate VM without this identity or trust.
  if [[ -e "$chain" ]]; then security delete-keychain "$chain"; fi
  rm -f "$cert"
  exit 0
fi

work=$(mktemp -d "$RUNNER_TEMP/chronos-signing.XXXXXX")
p12="$work/identity.p12"
trap 'rm -f "$p12"; rmdir "$work"' EXIT
printf '%s' "$IDENTITY_JSON" | jq -er .p12 | base64 -D > "$p12"
password=$(printf '%s' "$IDENTITY_JSON" | jq -er .password)
unset IDENTITY_JSON
keychain_password=$(openssl rand -hex 32)
security create-keychain -p "$keychain_password" "$chain"
# codesign also searches the user's keychain list when passed --keychain.
# This disposable signer has no other identity to use.
security list-keychains -d user -s "$chain"
security set-keychain-settings -lut 3600 "$chain"
security unlock-keychain -p "$keychain_password" "$chain"
P12_PASSWORD="$password" openssl pkcs12 -in "$p12" -passin env:P12_PASSWORD -noout
security import "$p12" -f pkcs12 -k "$chain" -P "$password" -T /usr/bin/codesign
unset password
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$chain" >/dev/null
security find-certificate -p -c 'Chronos Desktop Updates' "$chain" > "$cert"
actual=$(openssl x509 -in "$cert" -noout -fingerprint -sha1 | cut -d= -f2 | tr -d :)
test "$actual" = "$(cat chronos/ci/macos-signing.sha1)"
sudo security add-trusted-cert -d -r trustRoot -p codeSign -k /Library/Keychains/System.keychain "$cert"
security find-identity -v -p codesigning "$chain" | grep -F "$actual"
# Exercise the private key before starting electron-builder.
cp /usr/bin/true "$work/probe"
trap 'rm -f "$p12" "$work/probe"; rmdir "$work"' EXIT
codesign --force --timestamp=none --keychain "$chain" --sign "$actual" "$work/probe"
codesign --verify --strict "-R=certificate leaf = H\"$actual\"" "$work/probe"
printf 'CSC_KEYCHAIN=%s\n' "$chain" >> "$GITHUB_ENV"

#!/usr/bin/env bash
set -euo pipefail
app=${1:?Expected a Chronos.app bundle}
identity=$(cat chronos/ci/macos-signing.sha1)
id=io.github.zulut30.chronos
codesign --verify --deep --strict --all-architectures --verbose=2 \
  -R="identifier \"$id\" and certificate leaf = H\"$identity\"" "$app"
dr=$(codesign -dr - "$app" 2>&1 | sed -n 's/^designated => //p')
printf 'Designated requirement: %s\n' "$dr"
[[ "$(printf '%s' "$dr" | tr '[:upper:]' '[:lower:]')" == "identifier \"$id\" and certificate leaf = h\"$(printf '%s' "$identity" | tr '[:upper:]' '[:lower:]')\"" ]]

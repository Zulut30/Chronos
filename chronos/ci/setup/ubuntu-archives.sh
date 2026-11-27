#!/usr/bin/env bash
# These hosted jobs install distribution packages. Playwright later invokes apt
# through sudo too, so both invocations must inherit the same source selection.
set -euo pipefail
if [[ ${RUNNER_ENVIRONMENT:-} != github-hosted ]]; then
  echo "Expected a disposable GitHub-hosted runner" >&2
  exit 1
fi
if [[ -s /etc/apt/sources.list.d/ubuntu.sources ]]; then
  archive=sources.list.d/ubuntu.sources
else
  archive=sources.list
fi
test -s "/etc/apt/$archive"
printf 'Dir::Etc::sourcelist "%s";\nDir::Etc::sourceparts "-";\n' "$archive" |
  sudo tee /etc/apt/apt.conf.d/99chronos-ubuntu-archives >/dev/null

# Check apt's effective download plan without accessing any network endpoint.
plan=$(apt-get --print-uris update)
if [[ $plan != *InRelease* || $plan == *packages.microsoft.com* ]]; then
  echo "The selected Ubuntu archive is missing or includes the unrelated Microsoft feed" >&2
  exit 1
fi

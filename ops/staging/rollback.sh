#!/usr/bin/env bash
set -euo pipefail
ROOT="${STAGING_ROOT:-/opt/homefinance-staging}"
test -r "$ROOT/manifests/previous.json"
exec "$(dirname "$0")/deploy.sh" "$ROOT/manifests/previous.json"

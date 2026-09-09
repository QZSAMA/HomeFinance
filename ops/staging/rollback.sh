#!/usr/bin/env bash
set -euo pipefail
ROOT="${STAGING_ROOT:-/opt/homefinance-staging}"
test -r "$ROOT/manifests/previous.json"
test "${MANUAL_DATABASE_COMPATIBILITY_CONFIRMATION:-}" = "yes" || {
  echo "set MANUAL_DATABASE_COMPATIBILITY_CONFIRMATION=yes after confirming schema compatibility" >&2
  exit 2
}
"$ROOT/deploy.sh" "$ROOT/manifests/previous.json"
exec "$ROOT/promote.sh"

#!/usr/bin/env bash
set -euo pipefail
ROOT="${STAGING_ROOT:-/opt/homefinance-staging}"
MANIFEST="$ROOT/manifests/candidate.json"
ENV_FILE="$ROOT/.env"
CANIDATE_ENV_FILE="$ROOT/.env.candidate"
test -r "$MANIFEST"
test -r "$ENV_FILE"
test -r "$CANIDATE_ENV_FILE"
exec 9>"$ROOT/.deployment.lock"
flock -n 9 || { echo "another staging deployment is in progress" >&2; exit 1; }
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
cp "$ROOT/manifests/active.json" "$ROOT/manifests/previous.json" 2>/dev/null || true
mv "$CANIDATE_ENV_FILE" "$ENV_FILE"
mv "$MANIFEST" "$ROOT/manifests/active.json"
cp "$ROOT/manifests/active.json" "$ROOT/evidence/promote-$STAMP.manifest.json"

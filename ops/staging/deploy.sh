#!/usr/bin/env bash
set -euo pipefail
ROOT="${STAGING_ROOT:-/opt/homefinance-staging}"
MANIFEST="${1:?manifest path required}"
test -r "$MANIFEST"
grep -Eq '"backendDigest"[[:space:]]*:[[:space:]]*"sha256:[a-f0-9]{64}"' "$MANIFEST"
grep -Eq '"frontendDigest"[[:space:]]*:[[:space:]]*"sha256:[a-f0-9]{64}"' "$MANIFEST"
mkdir -p "$ROOT/manifests" "$ROOT/evidence"
cp "$MANIFEST" "$ROOT/manifests/candidate.json"
python3 - "$MANIFEST" "$ROOT/.env" <<'PY'
import json,sys,os
m=json.load(open(sys.argv[1])); env=open(sys.argv[2]).read() if os.path.exists(sys.argv[2]) else ''
lines=[x for x in env.splitlines() if not x.startswith(('BACKEND_IMAGE=','FRONTEND_IMAGE='))]
lines += [f"BACKEND_IMAGE=ghcr.io/qzsama/homefinance/backend@{m['backendDigest']}", f"FRONTEND_IMAGE=ghcr.io/qzsama/homefinance/frontend@{m['frontendDigest']}"]
open(sys.argv[2],'w').write('\n'.join(lines)+'\n')
PY
docker compose --env-file "$ROOT/.env" -f "$ROOT/compose.staging.yml" config >/dev/null
docker compose --env-file "$ROOT/.env" -f "$ROOT/compose.staging.yml" up -d
docker compose --env-file "$ROOT/.env" -f "$ROOT/compose.staging.yml" ps
cp "$ROOT/manifests/active.json" "$ROOT/manifests/previous.json" 2>/dev/null || true
mv "$ROOT/manifests/candidate.json" "$ROOT/manifests/active.json"

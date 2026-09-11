#!/usr/bin/env bash
set -euo pipefail
ROOT="${STAGING_ROOT:-/opt/homefinance-staging}"
MANIFEST="${1:?manifest path required}"
COMPOSE_FILE="$ROOT/compose.staging.yml"
ENV_FILE="$ROOT/.env"
test -r "$MANIFEST"
test -r "$COMPOSE_FILE"
test -r "$ENV_FILE"
exec 9>"$ROOT/.deployment.lock"
flock -n 9 || { echo "another staging deployment is in progress" >&2; exit 1; }
python3 - "$MANIFEST" <<'PY'
import json,re,sys
m=json.load(open(sys.argv[1]))
for name in ('commit', 'migrationHead', 'createdAt'):
    if not isinstance(m.get(name), str) or not m[name]: raise SystemExit(f'missing {name}')
for name in ('backendDigest', 'frontendDigest', 'mockAiDigest'):
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', m.get(name, '')): raise SystemExit(f'invalid {name}')
PY
mkdir -p "$ROOT/manifests" "$ROOT/evidence"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_FILE="$ROOT/evidence/deploy-$STAMP.log"
cp "$MANIFEST" "$ROOT/manifests/candidate.json"
cp "$ENV_FILE" "$ROOT/.env.candidate"
python3 - "$MANIFEST" "$ROOT/.env.candidate" <<'PY'
import json,sys,os
m=json.load(open(sys.argv[1])); env=open(sys.argv[2]).read() if os.path.exists(sys.argv[2]) else ''
lines=[x for x in env.splitlines() if not x.startswith(('BACKEND_IMAGE=','FRONTEND_IMAGE=','MOCK_AI_IMAGE='))]
lines += [f"BACKEND_IMAGE=ghcr.io/qzsama/homefinance/backend@{m['backendDigest']}", f"FRONTEND_IMAGE=ghcr.io/qzsama/homefinance/frontend@{m['frontendDigest']}", f"MOCK_AI_IMAGE=ghcr.io/qzsama/homefinance/mock-ai@{m['mockAiDigest']}"]
open(sys.argv[2],'w').write('\n'.join(lines)+'\n')
PY
if ! docker compose --env-file "$ROOT/.env.candidate" -f "$COMPOSE_FILE" config >/dev/null \
  || ! docker compose --env-file "$ROOT/.env.candidate" -f "$COMPOSE_FILE" pull \
  || ! docker compose --env-file "$ROOT/.env.candidate" -f "$COMPOSE_FILE" up -d --wait --wait-timeout 180 \
  || ! docker compose --env-file "$ROOT/.env.candidate" -f "$COMPOSE_FILE" exec -T backend npx prisma migrate status \
  || ! curl --fail --silent --show-error --retry 12 --retry-delay 5 http://127.0.0.1/api/health; then
  docker compose --env-file "$ROOT/.env.candidate" -f "$COMPOSE_FILE" ps | tee -a "$LOG_FILE" || true
  docker compose --env-file "$ROOT/.env.candidate" -f "$COMPOSE_FILE" logs --no-color | tee -a "$LOG_FILE" || true
  echo "candidate failed after startup; it remains running for diagnosis and forward recovery" | tee -a "$LOG_FILE"
  exit 1
fi
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps > "$ROOT/evidence/deploy-$STAMP.ps"
cp "$ROOT/manifests/candidate.json" "$ROOT/evidence/deploy-$STAMP.candidate.json"

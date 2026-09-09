#!/usr/bin/env bash
set -euo pipefail
ROOT="${STAGING_ROOT:-/opt/homefinance-staging}"
ENV_FILE="$ROOT/.env"
COMPOSE_FILE="$ROOT/compose.staging.yml"
test -r "$ENV_FILE"
test -r "$COMPOSE_FILE"
set -a
. "$ENV_FILE"
set +a
CLASS="${BACKUP_CLASS:-daily}"
case "$CLASS" in daily|weekly) ;; *) echo "BACKUP_CLASS must be daily or weekly" >&2; exit 2;; esac
OUT="$ROOT/backups/$CLASS/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB" > "$OUT/postgres.dump"
docker run --rm -v "$MINIO_VOLUME_NAME:/source:ro" -v "$OUT:/backup" alpine:3.20.6 tar -C /source -cf /backup/minio-data.tar .
sha256sum "$OUT"/* > "$OUT/SHA256SUMS"
echo "$OUT"

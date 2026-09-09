#!/usr/bin/env bash
set -euo pipefail
ROOT="${STAGING_ROOT:-/opt/homefinance-staging}"
OUT="$ROOT/backups/daily/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT"
docker compose -f "$ROOT/compose.staging.yml" exec -T postgres pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB" > "$OUT/postgres.dump"
tar -C "$ROOT" -cf "$OUT/minio.tar" data/minio 2>/dev/null || true
sha256sum "$OUT"/* > "$OUT/SHA256SUMS"
echo "$OUT"

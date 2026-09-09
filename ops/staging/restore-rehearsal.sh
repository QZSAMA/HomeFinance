#!/usr/bin/env bash
set -euo pipefail
ROOT="${STAGING_ROOT:-/opt/homefinance-staging}"
DUMP="${1:?backup directory required}/postgres.dump"
test -r "$DUMP"
docker compose -f "$ROOT/compose.staging.yml" exec -T postgres dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB"
docker compose -f "$ROOT/compose.staging.yml" exec -T postgres createdb -U "$POSTGRES_USER" "$POSTGRES_DB"
docker compose -f "$ROOT/compose.staging.yml" exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$DUMP"
docker compose -f "$ROOT/compose.staging.yml" exec -T backend npx prisma migrate deploy
echo "restore rehearsal completed"

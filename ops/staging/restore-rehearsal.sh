#!/usr/bin/env bash
set -euo pipefail
ROOT="${STAGING_ROOT:-/opt/homefinance-staging}"
BACKUP_DIR="${1:?backup directory required}"
ENV_FILE="$ROOT/.env"
COMPOSE_FILE="$ROOT/compose.staging.yml"
test -r "$BACKUP_DIR/postgres.dump"
test -r "$BACKUP_DIR/minio-data.tar"
test -r "$BACKUP_DIR/SHA256SUMS"
test -r "$ENV_FILE"
sha256sum -c "$BACKUP_DIR/SHA256SUMS"
set -a
. "$ENV_FILE"
set +a
RUN_ID="restore-$(date -u +%Y%m%dT%H%M%SZ)"
RESTORE_ROOT="$ROOT/restore/$RUN_ID"
RESTORE_ENV="$RESTORE_ROOT/.env"
mkdir -p "$RESTORE_ROOT"
cp "$ENV_FILE" "$RESTORE_ENV"
cat >> "$RESTORE_ENV" <<EOF
COMPOSE_PROJECT_NAME=homefinance-$RUN_ID
POSTGRES_VOLUME_NAME=homefinance-$RUN_ID-postgres-data
REDIS_VOLUME_NAME=homefinance-$RUN_ID-redis-data
MINIO_VOLUME_NAME=homefinance-$RUN_ID-minio-data
POSTGRES_DB=homefinance_restore
EOF
cleanup() {
  docker compose --env-file "$RESTORE_ENV" -f "$COMPOSE_FILE" down --volumes --remove-orphans || true
  rm -rf "$RESTORE_ROOT"
}
trap cleanup EXIT
docker volume create "homefinance-$RUN_ID-minio-data" >/dev/null
docker run --rm -v "homefinance-$RUN_ID-minio-data:/target" -v "$BACKUP_DIR:/backup:ro" alpine:3.20.6 tar -C /target -xf /backup/minio-data.tar
docker compose --env-file "$RESTORE_ENV" -f "$COMPOSE_FILE" up -d --wait postgres redis minio
docker compose --env-file "$RESTORE_ENV" -f "$COMPOSE_FILE" exec -T postgres pg_restore -U "$POSTGRES_USER" -d homefinance_restore < "$BACKUP_DIR/postgres.dump"
docker compose --env-file "$RESTORE_ENV" -f "$COMPOSE_FILE" up -d backend --wait --wait-timeout 180
docker compose --env-file "$RESTORE_ENV" -f "$COMPOSE_FILE" exec -T backend node -e "fetch('http://localhost:8080/api/health').then((r) => process.exit(r.ok ? 0 : 1))"
docker compose --env-file "$RESTORE_ENV" -f "$COMPOSE_FILE" exec -T backend npx prisma migrate status
tar -tf "$BACKUP_DIR/minio-data.tar" >/dev/null
echo "disposable restore rehearsal completed: $RUN_ID"

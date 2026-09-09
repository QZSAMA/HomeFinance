import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const deploy = readFileSync(new URL('./deploy.sh', import.meta.url), 'utf8');
const backup = readFileSync(new URL('./backup.sh', import.meta.url), 'utf8');
const restore = readFileSync(new URL('./restore-rehearsal.sh', import.meta.url), 'utf8');
const compose = readFileSync(new URL('./compose.staging.yml', import.meta.url), 'utf8');

assert.match(deploy, /sha256:\[a-f0-9\]\{64\}/);
assert.match(deploy, /mockAiDigest/);
assert.match(deploy, /\.env\.previous/);
assert.match(deploy, /up -d --wait --wait-timeout 180/);
assert.match(deploy, /prisma migrate status/);
assert.match(backup, /--env-file "\$ENV_FILE"/);
assert.match(backup, /MINIO_VOLUME_NAME/);
assert.doesNotMatch(backup, /\|\| true/);
assert.match(restore, /COMPOSE_PROJECT_NAME=homefinance-\$RUN_ID/);
assert.doesNotMatch(restore, /dropdb/);
assert.match(compose, /minio\/minio:RELEASE\.2025-04-22T22-12-26Z/);
assert.match(compose, /minio-proxy/);
console.log('staging contract PASS');

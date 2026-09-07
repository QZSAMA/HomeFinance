import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173/api';
const repositoryDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMPOSE = ['compose', '-p', 'homefinance-e2e', '-f', 'docker-compose.e2e.yml'];
const CHECKPOINTS = [
  'identity-and-family-setup',
  'redis-miss-hit-and-persisted-stale-key',
  'redis-outage-authorized-fresh-read-write',
  'redis-recovery-miss-hit-without-backend-restart',
  'minio-object-isolation-matrix',
  'minio-outage-preserves-file-row',
  'minio-recovery-and-second-lifecycle',
];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function runDocker(args, { allowFailure = false } = {}) {
  const result = spawnSync('docker', [...COMPOSE, ...args], {
    cwd: repositoryDirectory,
    encoding: 'utf8',
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw result.error ?? new Error(detail || `docker ${[...COMPOSE, ...args].join(' ')} exited ${result.status}`);
  }
  return result;
}

function describe(value) {
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function poll(label, operation, accept, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await operation();
      if (accept(last)) return last;
    } catch (error) {
      last = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`${label} timed out: ${describe(last)}`);
}

async function requestApi(pathname, {
  method = 'GET',
  token,
  json,
  form,
  headers = {},
  expectedStatus,
} = {}) {
  const requestHeaders = { ...headers };
  if (token) requestHeaders.Authorization = `Bearer ${token}`;
  if (json !== undefined) requestHeaders['Content-Type'] = 'application/json';

  const response = await fetch(`${API_BASE_URL}${pathname}`, {
    method,
    headers: requestHeaders,
    body: json === undefined ? form : JSON.stringify(json),
    signal: AbortSignal.timeout(15_000),
  });
  const rawBody = await response.text();
  let body = null;
  if (rawBody) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = rawBody;
    }
  }

  if (expectedStatus !== undefined && response.status !== expectedStatus) {
    throw new Error(`${method} ${pathname} expected ${expectedStatus}, received ${response.status}: ${rawBody}`);
  }
  return { response, body, rawBody };
}

async function checkpoint(name, operation) {
  const startedAt = Date.now();
  await operation();
  console.log(`PASS ${name} (${Date.now() - startedAt}ms)`);
}

function bearerIdentity(label, suffix) {
  return {
    email: `infra-${label}-${suffix}@example.test`,
    password: 'infra-e2e-password',
    name: `${label} ${suffix}`,
  };
}

async function register(identity) {
  const result = await requestApi('/auth/register', {
    method: 'POST',
    json: identity,
    expectedStatus: 201,
  });
  invariant(result.body?.token, `registration did not return a token for ${identity.email}`);
  invariant(result.body?.user?.id, `registration did not return a user id for ${identity.email}`);
  return result.body;
}

async function createFamily(token, name) {
  const result = await requestApi('/families', {
    method: 'POST',
    token,
    json: { name, timezone: 'Asia/Shanghai' },
    expectedStatus: 201,
  });
  invariant(result.body?.id, `family creation did not return an id for ${name}`);
  return result.body;
}

async function createIncome(token, familyId, amount, idempotencyKey) {
  const result = await requestApi(`/families/${familyId}/incomes`, {
    method: 'POST',
    token,
    headers: { 'Idempotency-Key': idempotencyKey },
    json: {
      amount,
      category: 'Salary',
      description: `P1-G-05 amount ${amount}`,
      date: new Date().toISOString(),
      currency: 'CNY',
    },
    expectedStatus: 201,
  });
  invariant(result.body?.id, `income ${amount} did not return an id`);
  return result.body;
}

async function readIncomeStatement(token, familyId, expectedStatus = 200) {
  return requestApi(`/families/${familyId}/reports/income-statement`, {
    token,
    expectedStatus,
  });
}

function assertIncomeStatement(result, expectedTotal) {
  invariant(result.body?.totalIncome === expectedTotal,
    `expected totalIncome ${expectedTotal}, received ${describe(result.body?.totalIncome)}`);
  invariant(result.body?.totalExpense === 0,
    `expected totalExpense 0, received ${describe(result.body?.totalExpense)}`);
  invariant(result.body?.netIncome === expectedTotal,
    `expected netIncome ${expectedTotal}, received ${describe(result.body?.netIncome)}`);
  invariant(result.body?.reconciliationStatus === 'passed',
    `expected passed reconciliation, received ${describe(result.body?.reconciliationStatus)}`);
}

function cacheState(result) {
  return result.response.headers.get('x-cache');
}

function formFor(filename, content) {
  const form = new FormData();
  form.append('files', new Blob([content], { type: 'text/plain' }), filename);
  return form;
}

async function uploadFile(token, familyId, filename, content, expectedStatus) {
  return requestApi(`/families/${familyId}/files/upload`, {
    method: 'POST',
    token,
    form: formFor(filename, content),
    expectedStatus,
  });
}

async function listFiles(token, familyId, expectedStatus = 200) {
  return requestApi(`/families/${familyId}/files`, { token, expectedStatus });
}

async function deleteFamilyFile(token, familyId, fileId, expectedStatus) {
  return requestApi(`/families/${familyId}/files/${fileId}`, {
    method: 'DELETE',
    token,
    expectedStatus,
  });
}

function fileRows(result) {
  invariant(Array.isArray(result.body), `expected a file array, received ${describe(result.body)}`);
  return result.body;
}

const minioClientSource = `
const Minio = require('minio');
const client = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT,
  port: Number(process.env.MINIO_PORT),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET_KEY,
  region: process.env.MINIO_REGION || 'us-east-1',
});
`;

function parseDockerJson(result, label) {
  const output = result.stdout.trim();
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`${label} returned invalid JSON: ${output}`);
  }
}

function statMinioObject(objectPath) {
  const script = `${minioClientSource}
const objectPath = process.argv[1];
client.statObject(process.env.MINIO_BUCKET, objectPath)
  .then((stat) => console.log(JSON.stringify({ exists: true, size: stat.size })))
  .catch((error) => {
    if (['NoSuchKey', 'NotFound', 'NoSuchObject'].includes(error.code) || error.statusCode === 404) {
      console.log(JSON.stringify({ exists: false, size: null }));
      return;
    }
    console.error(error);
    process.exitCode = 1;
  });`;
  return parseDockerJson(
    runDocker(['exec', '-T', 'backend', 'node', '-e', script, objectPath]),
    `MinIO stat ${objectPath}`,
  );
}

function listMinioObjects(prefix) {
  const script = `${minioClientSource}
const prefix = process.argv[1];
const names = [];
const stream = client.listObjectsV2(process.env.MINIO_BUCKET, prefix, true);
stream.on('data', (item) => names.push(item.name));
stream.on('error', (error) => { console.error(error); process.exitCode = 1; });
stream.on('end', () => console.log(JSON.stringify(names.sort())));`;
  return parseDockerJson(
    runDocker(['exec', '-T', 'backend', 'node', '-e', script, prefix]),
    `MinIO list ${prefix}`,
  );
}

async function waitForRedis() {
  await poll(
    'Redis health',
    async () => runDocker(['exec', '-T', 'redis', 'redis-cli', 'ping'], { allowFailure: true }),
    (result) => result.status === 0 && result.stdout.trim() === 'PONG',
  );
}

async function waitForMinio() {
  await poll(
    'MinIO health',
    async () => runDocker(
      ['exec', '-T', 'minio', 'curl', '-fsS', 'http://localhost:9000/minio/health/live'],
      { allowFailure: true },
    ),
    (result) => result.status === 0,
  );
}

async function main() {
  const suffix = `${Date.now()}-${process.pid}`;
  const state = {};

  await checkpoint(CHECKPOINTS[0], async () => {
    state.adminA = await register(bearerIdentity('admin-a', suffix));
    state.viewer = await register(bearerIdentity('viewer', suffix));
    state.adminB = await register(bearerIdentity('admin-b', suffix));
    state.familyA = await createFamily(state.adminA.token, `Recovery A ${suffix}`);
    state.familyB = await createFamily(state.adminB.token, `Recovery B ${suffix}`);

    const invitation = await requestApi(`/families/${state.familyA.id}/invite`, {
      method: 'POST',
      token: state.adminA.token,
      json: { email: state.viewer.user.email, role: 'viewer' },
      expectedStatus: 201,
    });
    const invitedViewer = invitation.body?.members?.find(
      (member) => member.userId === state.viewer.user.id,
    );
    invariant(invitedViewer?.role === 'viewer', 'viewer invitation was not persisted as viewer');
  });

  await checkpoint(CHECKPOINTS[1], async () => {
    await createIncome(state.adminA.token, state.familyA.id, 100, `p1-g05-income-100-${suffix}`);
    const first = await readIncomeStatement(state.adminA.token, state.familyA.id);
    assertIncomeStatement(first, 100);
    invariant(cacheState(first) === 'MISS', `expected first report MISS, received ${cacheState(first)}`);

    await poll(
      'initial report HIT',
      () => readIncomeStatement(state.adminA.token, state.familyA.id),
      (result) => {
        assertIncomeStatement(result, 100);
        return cacheState(result) === 'HIT';
      },
    );

    const pattern = `cache:family:v2:${state.familyA.id}:v*:*income-statement*`;
    const scan = runDocker([
      'exec', '-T', 'redis', 'redis-cli', '--raw', '--scan', '--pattern', pattern,
    ]);
    const keys = scan.stdout.split(/\r?\n/).map((key) => key.trim()).filter(Boolean);
    invariant(keys.length === 1, `expected one old income-statement key, received ${describe(keys)}`);
    state.oldRedisKey = keys[0];
    const save = runDocker(['exec', '-T', 'redis', 'redis-cli', 'SAVE']);
    invariant(save.stdout.trim() === 'OK', `Redis SAVE failed: ${save.stdout}`);
  });

  await checkpoint(CHECKPOINTS[2], async () => {
    runDocker(['stop', 'redis']);

    const outageRead = await poll(
      'authorized report during Redis outage',
      () => readIncomeStatement(state.adminA.token, state.familyA.id),
      (result) => {
        assertIncomeStatement(result, 100);
        return true;
      },
    );
    invariant(cacheState(outageRead) !== 'HIT', 'Redis outage unexpectedly served a cached HIT');

    await readIncomeStatement(undefined, state.familyA.id, 401);
    await readIncomeStatement(state.adminB.token, state.familyA.id, 403);

    await createIncome(state.adminA.token, state.familyA.id, 25, `p1-g05-income-25-${suffix}`);
    const freshDuringOutage = await readIncomeStatement(state.adminA.token, state.familyA.id);
    assertIncomeStatement(freshDuringOutage, 125);
    invariant(cacheState(freshDuringOutage) !== 'HIT', 'Redis outage write/read unexpectedly used HIT');
  });

  await checkpoint(CHECKPOINTS[3], async () => {
    runDocker(['start', 'redis']);
    await waitForRedis();

    const oldKey = runDocker([
      'exec', '-T', 'redis', 'redis-cli', 'EXISTS', state.oldRedisKey,
    ]);
    invariant(oldKey.stdout.trim() === '1', `persisted old Redis key is missing: ${state.oldRedisKey}`);

    await poll(
      'new-version report MISS after Redis recovery',
      () => readIncomeStatement(state.adminA.token, state.familyA.id),
      (result) => {
        assertIncomeStatement(result, 125);
        return cacheState(result) === 'MISS';
      },
    );
    await poll(
      'new-version report HIT after Redis recovery',
      () => readIncomeStatement(state.adminA.token, state.familyA.id),
      (result) => {
        assertIncomeStatement(result, 125);
        return cacheState(result) === 'HIT';
      },
    );
  });

  const assertOriginalFilePreserved = async () => {
    const familyAList = fileRows(await listFiles(state.adminA.token, state.familyA.id));
    invariant(familyAList.length === 1, `family A list changed unexpectedly: ${describe(familyAList)}`);
    invariant(familyAList[0].id === state.originalFile.id, 'family A original file row changed');
    const stat = statMinioObject(state.originalFile.path);
    invariant(stat.exists && stat.size === state.originalContent.length,
      `family A original object changed: ${describe(stat)}`);
    const objects = listMinioObjects(`${state.familyA.id}/`);
    invariant(
      objects.length === 1 && objects[0] === state.originalFile.path,
      `family A object set changed unexpectedly: ${describe(objects)}`,
    );
  };

  await checkpoint(CHECKPOINTS[4], async () => {
    state.originalContent = Buffer.from(`family-a-original-${suffix}`, 'utf8');
    const uploaded = await uploadFile(
      state.adminA.token,
      state.familyA.id,
      'family-a-original.txt',
      state.originalContent,
      201,
    );
    invariant(Array.isArray(uploaded.body?.files) && uploaded.body.files.length === 1,
      `upload did not return one file row: ${describe(uploaded.body)}`);
    state.originalFile = uploaded.body.files[0];
    invariant(state.originalFile.path.startsWith(`${state.familyA.id}/`),
      `object path is not family-prefixed: ${state.originalFile.path}`);

    const listed = fileRows(await listFiles(state.adminA.token, state.familyA.id));
    const listedOriginal = listed.find((file) => file.id === state.originalFile.id);
    invariant(listedOriginal?.url, 'family A list did not include a signed URL');
    state.originalUrl = listedOriginal.url;
    await assertOriginalFilePreserved();

    await listFiles(undefined, state.familyA.id, 401);
    await uploadFile(undefined, state.familyA.id, 'unauthenticated.txt', 'blocked', 401);
    await assertOriginalFilePreserved();
    await deleteFamilyFile(undefined, state.familyA.id, state.originalFile.id, 401);
    await assertOriginalFilePreserved();

    await listFiles(state.adminB.token, state.familyA.id, 403);
    await uploadFile(state.adminB.token, state.familyA.id, 'non-member.txt', 'blocked', 403);
    await assertOriginalFilePreserved();
    await deleteFamilyFile(state.adminB.token, state.familyA.id, state.originalFile.id, 403);
    await assertOriginalFilePreserved();

    const viewerList = fileRows(await listFiles(state.viewer.token, state.familyA.id));
    invariant(viewerList.some((file) => file.id === state.originalFile.id), 'viewer cannot list family A file');
    await uploadFile(state.viewer.token, state.familyA.id, 'viewer.txt', 'blocked', 403);
    await assertOriginalFilePreserved();
    await deleteFamilyFile(state.viewer.token, state.familyA.id, state.originalFile.id, 403);
    await assertOriginalFilePreserved();

    await deleteFamilyFile(state.adminB.token, state.familyB.id, state.originalFile.id, 404);
    await assertOriginalFilePreserved();

    const familyBListResult = await listFiles(state.adminB.token, state.familyB.id);
    const familyBList = fileRows(familyBListResult);
    invariant(familyBList.length === 0, `family B leaked file metadata: ${describe(familyBList)}`);
    const serializedFamilyB = JSON.stringify(familyBListResult.body);
    invariant(!serializedFamilyB.includes(state.originalFile.id), 'family B leaked family A file id');
    invariant(!serializedFamilyB.includes(state.originalFile.path), 'family B leaked family A object path');
    invariant(!serializedFamilyB.includes(state.originalUrl), 'family B leaked family A signed URL');
  });

  await checkpoint(CHECKPOINTS[5], async () => {
    runDocker(['stop', 'minio']);

    const failedUpload = await uploadFile(
      state.adminA.token,
      state.familyA.id,
      'minio-outage.txt',
      'must-not-be-created',
      503,
    );
    invariant(failedUpload.body?.code === 'STORAGE_UNAVAILABLE',
      `outage upload returned wrong code: ${describe(failedUpload.body)}`);
    invariant(failedUpload.body?.files === undefined, 'outage upload exposed a false files result');

    const afterFailedUpload = fileRows(await listFiles(state.adminA.token, state.familyA.id));
    invariant(
      afterFailedUpload.length === 1 && afterFailedUpload[0].id === state.originalFile.id,
      `outage upload changed file rows: ${describe(afterFailedUpload)}`,
    );

    const failedDelete = await deleteFamilyFile(
      state.adminA.token,
      state.familyA.id,
      state.originalFile.id,
      503,
    );
    invariant(failedDelete.body?.code === 'STORAGE_UNAVAILABLE',
      `outage delete returned wrong code: ${describe(failedDelete.body)}`);

    const afterFailedDelete = fileRows(await listFiles(state.adminA.token, state.familyA.id));
    invariant(
      afterFailedDelete.length === 1 && afterFailedDelete[0].id === state.originalFile.id,
      `outage delete removed the file row: ${describe(afterFailedDelete)}`,
    );
  });

  await checkpoint(CHECKPOINTS[6], async () => {
    runDocker(['start', 'minio']);
    await waitForMinio();
    await assertOriginalFilePreserved();

    await deleteFamilyFile(state.adminA.token, state.familyA.id, state.originalFile.id, 200);
    const afterDelete = fileRows(await listFiles(state.adminA.token, state.familyA.id));
    invariant(!afterDelete.some((file) => file.id === state.originalFile.id),
      'recovered delete retained the original database row');
    invariant(statMinioObject(state.originalFile.path).exists === false,
      'recovered delete retained the original MinIO object');

    const recoveredContent = Buffer.from(`post-recovery-${suffix}`, 'utf8');
    const recoveredUpload = await uploadFile(
      state.adminA.token,
      state.familyA.id,
      'post-recovery.txt',
      recoveredContent,
      201,
    );
    invariant(Array.isArray(recoveredUpload.body?.files) && recoveredUpload.body.files.length === 1,
      `post-recovery upload failed: ${describe(recoveredUpload.body)}`);
    const recoveredFile = recoveredUpload.body.files[0];
    invariant(recoveredFile.path.startsWith(`${state.familyA.id}/`),
      `post-recovery path is not family-prefixed: ${recoveredFile.path}`);
    const recoveredStat = statMinioObject(recoveredFile.path);
    invariant(recoveredStat.exists && recoveredStat.size === recoveredContent.length,
      `post-recovery object mismatch: ${describe(recoveredStat)}`);

    await deleteFamilyFile(state.adminA.token, state.familyA.id, recoveredFile.id, 200);
    const finalRows = fileRows(await listFiles(state.adminA.token, state.familyA.id));
    invariant(finalRows.length === 0, `post-recovery lifecycle left file rows: ${describe(finalRows)}`);
    invariant(statMinioObject(recoveredFile.path).exists === false,
      'post-recovery lifecycle left a MinIO object');
    invariant(listMinioObjects(`${state.familyA.id}/`).length === 0,
      'post-recovery lifecycle left an unexpected family A object');
  });
}

if (process.argv.includes('--list')) {
  for (const name of CHECKPOINTS) console.log(name);
} else {
  main().catch((error) => {
    console.error(`FAIL ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

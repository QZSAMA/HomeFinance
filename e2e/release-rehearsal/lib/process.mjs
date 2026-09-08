import { spawnSync } from 'node:child_process';

const REDACTIONS = [
  [/postgresql:\/\/[^\s'"@]+:[^\s'"@]+@[^\s'"]+/gi, '[REDACTED_DATABASE_URL]'],
  [/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]'],
  [/(passwordHash|JWT_SECRET|MINIO_ROOT_PASSWORD|MINIO_SECRET_KEY)(\s*[:=]\s*)[^\s,;]+/gi, '$1$2[REDACTED]'],
  [/rehearsal-postgres-password/gi, '[REDACTED_PASSWORD]'],
];

export function redact(value) {
  return REDACTIONS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    String(value ?? ''),
  );
}

export function runChecked(command, args, {
  cwd,
  env,
  input,
  allowFailure = false,
  maxBuffer = 8 * 1024 * 1024,
} = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    input,
    encoding: 'utf8',
    maxBuffer,
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    const detail = redact([result.stderr, result.stdout].filter(Boolean).join('\n').trim());
    const rendered = redact([command, ...args].join(' '));
    throw result.error ?? new Error(
      `${rendered} exited ${result.status}${detail ? `: ${detail}` : ''}`,
    );
  }
  return {
    ...result,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

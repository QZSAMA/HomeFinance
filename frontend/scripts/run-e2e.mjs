import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const frontendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryDirectory = resolve(frontendDirectory, '..');
const npmCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`);
  }
}

const composeArguments = ['compose', '-p', 'homefinance-e2e', '-f', 'docker-compose.e2e.yml'];
let composeStarted = false;
let exitCode = 0;

try {
  run('docker', ['--version'], repositoryDirectory);
  composeStarted = true;
  run('docker', [...composeArguments, 'up', '--build', '--detach', '--wait'], repositoryDirectory);
  run(npmCommand, ['playwright', 'test'], frontendDirectory);
} catch (error) {
  exitCode = 1;
  const detail = error instanceof Error && 'code' in error && error.code === 'ENOENT'
    ? 'Docker is not available. Start Docker Desktop and ensure the docker CLI is on PATH.'
    : error instanceof Error ? error.message : String(error);
  console.error(`E2E stack failed: ${detail}`);
} finally {
  if (composeStarted && process.env.E2E_KEEP_STACK !== '1') {
    try {
      run('docker', [...composeArguments, 'down', '--volumes', '--remove-orphans'], repositoryDirectory);
    } catch (error) {
      exitCode = 1;
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`E2E cleanup failed: ${detail}`);
    }
  }
}

process.exitCode = exitCode;

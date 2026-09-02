type JestConfig = {
  testPathIgnorePatterns: string[];
};

type PackageJson = {
  scripts: Record<string, string>;
};

function loadConfig(runIntegration?: string): JestConfig {
  const previous = process.env.RUN_INTEGRATION;

  if (runIntegration === undefined) {
    delete process.env.RUN_INTEGRATION;
  } else {
    process.env.RUN_INTEGRATION = runIntegration;
  }

  jest.resetModules();
  const config = require('../../jest.config.js') as JestConfig;

  if (previous === undefined) {
    delete process.env.RUN_INTEGRATION;
  } else {
    process.env.RUN_INTEGRATION = previous;
  }

  return config;
}

describe('Jest integration test isolation', () => {
  test.each([
    'C:\\repo\\backend\\src\\tests\\database.integration.test.ts',
    'C:\\repo\\backend\\src\\tests\\database.phase1.integration.test.ts',
    '/repo/backend/src/tests/phase1-concurrency.integration.test.ts',
  ])('excludes every database integration suite by default: %s', (testPath) => {
    const config = loadConfig();
    const [pattern] = config.testPathIgnorePatterns;

    expect(pattern).toBeDefined();
    expect(new RegExp(pattern).test(testPath)).toBe(true);
  });

  test('includes the database integration suite only when explicitly enabled', () => {
    expect(loadConfig('0').testPathIgnorePatterns).toHaveLength(1);
    expect(loadConfig('false').testPathIgnorePatterns).toHaveLength(1);
    expect(loadConfig('1').testPathIgnorePatterns).toEqual([]);
  });

  test('runs every integration suite through the dedicated package script', () => {
    const packageJson = require('../../package.json') as PackageJson;

    expect(packageJson.scripts['test:integration']).toContain('jest');
    expect(packageJson.scripts['test:integration']).not.toContain(
      'src/tests/database.integration.test.ts',
    );
    expect(packageJson.scripts['test:integration']).toContain(
      '--testPathPattern=\\.integration\\.test\\.ts$',
    );
  });
});

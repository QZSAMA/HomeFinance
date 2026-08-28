type JestConfig = {
  testPathIgnorePatterns: string[];
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
  test('excludes the database integration suite on Windows and POSIX by default', () => {
    const config = loadConfig();
    const [pattern] = config.testPathIgnorePatterns;

    expect(pattern).toBeDefined();
    expect(
      new RegExp(pattern).test('C:\\repo\\backend\\src\\tests\\database.integration.test.ts'),
    ).toBe(true);
    expect(
      new RegExp(pattern).test('/repo/backend/src/tests/database.integration.test.ts'),
    ).toBe(true);
  });

  test('includes the database integration suite only when explicitly enabled', () => {
    expect(loadConfig('0').testPathIgnorePatterns).toHaveLength(1);
    expect(loadConfig('false').testPathIgnorePatterns).toHaveLength(1);
    expect(loadConfig('1').testPathIgnorePatterns).toEqual([]);
  });
});

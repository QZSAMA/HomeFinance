describe('server lifecycle', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('continues in degraded mode when MinIO initialization fails and cleans up on shutdown', async () => {
    const unavailable = new Error('MinIO unavailable');
    const close = jest.fn((callback: () => void) => callback());
    const listener = { close };
    const listen = jest.fn((_port: number, callback: () => void) => {
      callback();
      return listener;
    });
    const disconnect = jest.fn().mockResolvedValue(undefined);
    const existingSigtermHandlers = new Set(process.listeners('SIGTERM'));
    const existingSigintHandlers = new Set(process.listeners('SIGINT'));
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    jest.doMock('./app', () => ({
      __esModule: true,
      default: { listen },
    }));
    jest.doMock('minio', () => ({
      Client: jest.fn().mockImplementation(() => ({
        bucketExists: jest.fn().mockRejectedValue(unavailable),
        makeBucket: jest.fn(),
      })),
    }));
    jest.doMock('./config/redis', () => ({
      connectRedis: jest.fn().mockResolvedValue(undefined),
    }));
    jest.doMock('./db/prisma', () => ({
      prisma: { $disconnect: disconnect },
    }));

    const { startServer } = await import('./server');
    const server = await startServer();

    expect(server).toBe(listener);
    expect(error).toHaveBeenCalledWith(unavailable);

    const [shutdown] = process
      .listeners('SIGTERM')
      .filter((handler) => !existingSigtermHandlers.has(handler));
    const [sigintShutdown] = process
      .listeners('SIGINT')
      .filter((handler) => !existingSigintHandlers.has(handler));

    expect(shutdown).toBeDefined();
    expect(sigintShutdown).toBe(shutdown);
    try {
      await Promise.all([
        Promise.resolve(shutdown?.('SIGTERM')),
        Promise.resolve(shutdown?.('SIGTERM')),
      ]);
    } finally {
      if (shutdown) process.removeListener('SIGTERM', shutdown);
      if (sigintShutdown) process.removeListener('SIGINT', sigintShutdown);
    }

    expect(close).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});

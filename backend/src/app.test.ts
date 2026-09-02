import http from 'http';

describe('app construction', () => {
  test('imports without opening a listener or initializing external services', () => {
    const listen = jest.spyOn(http.Server.prototype, 'listen');

    expect(() => {
      jest.isolateModules(() => {
        jest.doMock('@prisma/client', () => ({
          PrismaClient: jest.fn().mockImplementation(() => ({})),
        }));
        jest.doMock('./config/redis', () => ({
          connectRedis: jest.fn().mockResolvedValue(undefined),
          redisClient: { isOpen: false },
        }));
      jest.doMock('./config/minio', () => ({
        ensureBucket: jest.fn().mockResolvedValue(undefined),
      }));
      for (const route of [
        './routes/auth', './routes/families', './routes/incomes', './routes/expenses',
        './routes/assets', './routes/liabilities', './routes/reports', './routes/files',
        './routes/ai', './routes/budgets', './routes/export', './routes/recurring',
        './routes/category', './routes/compare', './routes/import', './routes/goals',
      ]) {
        jest.doMock(route, () => jest.fn((_req: unknown, _res: unknown, next: () => void) => next()));
      }
      require('./app');
      });
    }).not.toThrow();

    expect(listen).not.toHaveBeenCalled();
    expect(require('./config/redis').connectRedis).not.toHaveBeenCalled();
    expect(require('./config/minio').ensureBucket).not.toHaveBeenCalled();
    listen.mockRestore();
  });
});

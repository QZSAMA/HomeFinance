import { initScheduler, stopScheduler } from './scheduler';

jest.mock('node-cron', () => ({
  schedule: jest.fn(),
}));

jest.mock('../services/syncService', () => ({
  syncAllActiveSources: jest.fn(),
}));

jest.mock('../app', () => ({
  prisma: {},
}));

import cron from 'node-cron';
import { syncAllActiveSources } from '../services/syncService';

const mockedCron = cron as jest.Mocked<typeof cron>;
const mockedSyncAll = syncAllActiveSources as jest.MockedFunction<
  typeof syncAllActiveSources
>;

describe('scheduler', () => {
  const mockTask = { stop: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCron.schedule.mockReturnValue(mockTask as any);
    mockedSyncAll.mockResolvedValue({ total: 0, success: 0, failed: 0 });
    process.env.ENABLE_SCHEDULER = 'true';
    // 确保每个测试开始时调度器是停止状态
    stopScheduler();
  });

  afterEach(() => {
    stopScheduler();
  });

  test('initScheduler 调用 cron.schedule 注册任务', () => {
    initScheduler();

    expect(mockedCron.schedule).toHaveBeenCalledWith(
      '0 2 * * *',
      expect.any(Function)
    );
  });

  test('stopScheduler 调用 task.stop 停止任务', () => {
    initScheduler();

    stopScheduler();

    expect(mockTask.stop).toHaveBeenCalled();
  });

  test('ENABLE_SCHEDULER=false 时不初始化', () => {
    process.env.ENABLE_SCHEDULER = 'false';

    initScheduler();

    expect(mockedCron.schedule).not.toHaveBeenCalled();
  });

  test('cron 触发时调用 syncAllActiveSources', async () => {
    initScheduler();

    const callback = mockedCron.schedule.mock.calls[0][1] as () => void;
    await callback();

    expect(mockedSyncAll).toHaveBeenCalled();
  });

  test('initScheduler 多次调用不会重复注册', () => {
    initScheduler();
    initScheduler();
    initScheduler();

    expect(mockedCron.schedule).toHaveBeenCalledTimes(1);
  });
});

import { initScheduler, stopScheduler, getSchedulerStatus } from './scheduler';

jest.mock('node-cron', () => ({
  schedule: jest.fn(),
}));

jest.mock('../services/syncService', () => ({
  syncAllActiveSources: jest.fn(),
}));

jest.mock('../services/netWorthService', () => ({
  syncAllFamiliesNetWorth: jest.fn(),
}));

jest.mock('../app', () => ({
  prisma: {},
}));

import cron from 'node-cron';
import { syncAllActiveSources } from '../services/syncService';
import { syncAllFamiliesNetWorth } from '../services/netWorthService';

const mockedCron = cron as jest.Mocked<typeof cron>;
const mockedSyncAll = syncAllActiveSources as jest.MockedFunction<
  typeof syncAllActiveSources
>;
const mockedSyncNetWorth = syncAllFamiliesNetWorth as jest.MockedFunction<
  typeof syncAllFamiliesNetWorth
>;

describe('scheduler', () => {
  const mockTask = { stop: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCron.schedule.mockReturnValue(mockTask as any);
    mockedSyncAll.mockResolvedValue({ total: 0, success: 0, failed: 0 });
    mockedSyncNetWorth.mockResolvedValue({ total: 0, success: 0, failed: 0 });
    process.env.ENABLE_SCHEDULER = 'true';
    // 确保每个测试开始时调度器是停止状态
    stopScheduler();
  });

  afterEach(() => {
    stopScheduler();
  });

  test('initScheduler 调用 cron.schedule 注册账单同步任务', () => {
    initScheduler();

    expect(mockedCron.schedule).toHaveBeenCalledWith(
      '0 2 * * *',
      expect.any(Function)
    );
  });

  test('initScheduler 调用 cron.schedule 注册净值快照任务', () => {
    initScheduler();

    expect(mockedCron.schedule).toHaveBeenCalledWith(
      '0 0 * * *',
      expect.any(Function)
    );
  });

  test('stopScheduler 调用 task.stop 停止任务', () => {
    initScheduler();

    stopScheduler();

    // 两个任务都应被停止
    expect(mockTask.stop).toHaveBeenCalledTimes(2);
  });

  test('ENABLE_SCHEDULER=false 时不初始化', () => {
    process.env.ENABLE_SCHEDULER = 'false';

    initScheduler();

    expect(mockedCron.schedule).not.toHaveBeenCalled();
  });

  test('账单同步 cron 触发时调用 syncAllActiveSources', async () => {
    initScheduler();

    // 找到 '0 2 * * *' 对应的回调
    const syncCall = mockedCron.schedule.mock.calls.find(
      (call) => call[0] === '0 2 * * *'
    );
    const callback = syncCall![1] as () => void;
    await callback();

    expect(mockedSyncAll).toHaveBeenCalled();
  });

  test('净值快照 cron 触发时调用 syncAllFamiliesNetWorth', async () => {
    initScheduler();

    // 找到 '0 0 * * *' 对应的回调
    const netWorthCall = mockedCron.schedule.mock.calls.find(
      (call) => call[0] === '0 0 * * *'
    );
    const callback = netWorthCall![1] as () => void;
    await callback();

    expect(mockedSyncNetWorth).toHaveBeenCalled();
  });

  test('initScheduler 多次调用不会重复注册', () => {
    initScheduler();
    initScheduler();
    initScheduler();

    // 2 个任务，每个只注册 1 次
    expect(mockedCron.schedule).toHaveBeenCalledTimes(2);
  });

  test('getSchedulerStatus 在未初始化时返回 running=false', () => {
    const status = getSchedulerStatus();
    expect(status.running).toBe(false);
    expect(status.jobs).toEqual([]);
  });

  test('getSchedulerStatus 在初始化后返回 running=true 和任务列表', () => {
    initScheduler();
    const status = getSchedulerStatus();
    expect(status.running).toBe(true);
    expect(status.jobs).toHaveLength(2);
    expect(status.jobs).toContain('账单同步');
    expect(status.jobs).toContain('净值快照');
  });

  test('getSchedulerStatus 在停止后返回 running=false', () => {
    initScheduler();
    stopScheduler();
    const status = getSchedulerStatus();
    expect(status.running).toBe(false);
    expect(status.jobs).toEqual([]);
  });
});

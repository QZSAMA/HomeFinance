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

jest.mock('../services/anomalyService', () => ({
  detectAnomaliesForAll: jest.fn(),
}));

jest.mock('../services/budgetAlertService', () => ({
  checkBudgetAlertsForAll: jest.fn(),
}));

jest.mock('../app', () => ({
  prisma: {},
}));

import cron from 'node-cron';
import { syncAllActiveSources } from '../services/syncService';
import { syncAllFamiliesNetWorth } from '../services/netWorthService';
import { detectAnomaliesForAll } from '../services/anomalyService';
import { checkBudgetAlertsForAll } from '../services/budgetAlertService';

const mockedCron = cron as jest.Mocked<typeof cron>;
const mockedSyncAll = syncAllActiveSources as jest.MockedFunction<
  typeof syncAllActiveSources
>;
const mockedSyncNetWorth = syncAllFamiliesNetWorth as jest.MockedFunction<
  typeof syncAllFamiliesNetWorth
>;
const mockedDetectAnomalies = detectAnomaliesForAll as jest.MockedFunction<
  typeof detectAnomaliesForAll
>;
const mockedCheckBudgetAlertsForAll = checkBudgetAlertsForAll as jest.MockedFunction<
  typeof checkBudgetAlertsForAll
>;

describe('scheduler', () => {
  const mockTask = { stop: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCron.schedule.mockReturnValue(mockTask as any);
    mockedSyncAll.mockResolvedValue({ total: 0, success: 0, failed: 0 });
    mockedSyncNetWorth.mockResolvedValue({ total: 0, success: 0, failed: 0 });
    mockedDetectAnomalies.mockResolvedValue({ total: 0, found: 0 });
    mockedCheckBudgetAlertsForAll.mockResolvedValue({ total: 0, alerted: 0 });
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

  test('initScheduler 调用 cron.schedule 注册异常检测任务', () => {
    initScheduler();

    expect(mockedCron.schedule).toHaveBeenCalledWith(
      '0 8 * * *',
      expect.any(Function)
    );
  });

  test('initScheduler 调用 cron.schedule 注册预算告警任务', () => {
    initScheduler();

    expect(mockedCron.schedule).toHaveBeenCalledWith(
      '0 9 * * *',
      expect.any(Function)
    );
  });

  test('stopScheduler 调用 task.stop 停止任务', () => {
    initScheduler();

    stopScheduler();

    // 四个任务都应被停止
    expect(mockTask.stop).toHaveBeenCalledTimes(4);
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

  test('异常检测 cron 触发时调用 detectAnomaliesForAll', async () => {
    initScheduler();

    // 找到 '0 8 * * *' 对应的回调
    const anomalyCall = mockedCron.schedule.mock.calls.find(
      (call) => call[0] === '0 8 * * *'
    );
    const callback = anomalyCall![1] as () => void;
    await callback();

    expect(mockedDetectAnomalies).toHaveBeenCalled();
  });

  test('预算告警 cron 触发时调用 checkBudgetAlertsForAll', async () => {
    initScheduler();

    // 找到 '0 9 * * *' 对应的回调
    const budgetAlertCall = mockedCron.schedule.mock.calls.find(
      (call) => call[0] === '0 9 * * *'
    );
    const callback = budgetAlertCall![1] as () => void;
    await callback();

    expect(mockedCheckBudgetAlertsForAll).toHaveBeenCalled();
  });

  test('initScheduler 多次调用不会重复注册', () => {
    initScheduler();
    initScheduler();
    initScheduler();

    // 4 个任务，每个只注册 1 次
    expect(mockedCron.schedule).toHaveBeenCalledTimes(4);
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
    expect(status.jobs).toHaveLength(4);
    expect(status.jobs).toContain('账单同步');
    expect(status.jobs).toContain('净值快照');
    expect(status.jobs).toContain('异常检测');
    expect(status.jobs).toContain('预算告警');
  });

  test('getSchedulerStatus 在停止后返回 running=false', () => {
    initScheduler();
    stopScheduler();
    const status = getSchedulerStatus();
    expect(status.running).toBe(false);
    expect(status.jobs).toEqual([]);
  });
});

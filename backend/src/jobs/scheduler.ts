import cron, { ScheduledTask } from 'node-cron';
import { syncAllActiveSources } from '../services/syncService';
import { syncAllFamiliesNetWorth } from '../services/netWorthService';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('scheduler');

const SYNC_BILL_CRON = '0 2 * * *';
const NET_WORTH_CRON = '0 0 * * *';

interface ScheduledJob {
  name: string;
  task: ScheduledTask;
}

let scheduledJobs: ScheduledJob[] = [];

/**
 * 初始化定时任务调度器。
 * - 每日凌晨 0:00 执行 syncAllFamiliesNetWorth（净值快照）
 * - 每日凌晨 2:00 执行 syncAllActiveSources（账单同步）
 * 通过环境变量 ENABLE_SCHEDULER 控制（默认 true，设为 false 禁用）。
 * 多次调用幂等：已存在任务时不重复注册。
 */
export function initScheduler(): void {
  if (scheduledJobs.length > 0) {
    return;
  }

  const enabled = process.env.ENABLE_SCHEDULER !== 'false';
  if (!enabled) {
    logger.info('定时调度器已通过 ENABLE_SCHEDULER=false 禁用');
    return;
  }

  const netWorthTask = cron.schedule(NET_WORTH_CRON, async () => {
    try {
      const result = await syncAllFamiliesNetWorth();
      logger.info('定时净值快照同步完成', {
        total: result.total,
        success: result.success,
        failed: result.failed,
      });
    } catch (err) {
      logger.error('定时净值快照同步失败', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  const syncTask = cron.schedule(SYNC_BILL_CRON, async () => {
    try {
      const result = await syncAllActiveSources();
      logger.info('定时账单同步完成', {
        total: result.total,
        success: result.success,
        failed: result.failed,
      });
    } catch (err) {
      logger.error('定时账单同步失败', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  scheduledJobs = [
    { name: '净值快照', task: netWorthTask },
    { name: '账单同步', task: syncTask },
  ];

  logger.info('定时调度器已初始化', {
    jobs: scheduledJobs.map((j) => j.name),
  });
}

/**
 * 停止定时任务调度器，停止并清理所有已注册任务。
 */
export function stopScheduler(): void {
  for (const job of scheduledJobs) {
    job.task.stop();
  }
  scheduledJobs = [];
}

/**
 * 返回调度器当前状态。
 * - running：是否处于运行中
 * - jobs：当前已注册任务的名称列表
 */
export function getSchedulerStatus(): { running: boolean; jobs: string[] } {
  return {
    running: scheduledJobs.length > 0,
    jobs: scheduledJobs.map((j) => j.name),
  };
}

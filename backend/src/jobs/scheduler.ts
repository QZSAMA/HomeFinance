import cron, { ScheduledTask } from 'node-cron';
import { syncAllActiveSources } from '../services/syncService';
import { syncAllFamiliesNetWorth } from '../services/netWorthService';
import { detectAnomaliesForAll } from '../services/anomalyService';
import { checkBudgetAlertsForAll } from '../services/budgetAlertService';
import { retryFailedDeliveries } from '../services/notificationDispatcher';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('scheduler');

const SYNC_BILL_CRON = '0 2 * * *';
const NET_WORTH_CRON = '0 0 * * *';
const ANOMALY_DETECT_CRON = '0 8 * * *';
const BUDGET_ALERT_CRON = '0 9 * * *';
const NOTIFICATION_RETRY_CRON = '*/30 * * * *';

interface ScheduledJob {
  name: string;
  task: ScheduledTask;
}

let scheduledJobs: ScheduledJob[] = [];

/**
 * 初始化定时任务调度器。
 * - 每日凌晨 0:00 执行 syncAllFamiliesNetWorth（净值快照）
 * - 每日凌晨 2:00 执行 syncAllActiveSources（账单同步）
 * - 每日上午 8:00 执行 detectAnomaliesForAll（异常检测）
 * - 每日上午 9:00 执行 checkBudgetAlertsForAll（预算告警）
 * - 每 30 分钟执行 retryFailedDeliveries（通知投递重试）
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

  const anomalyTask = cron.schedule(ANOMALY_DETECT_CRON, async () => {
    try {
      const result = await detectAnomaliesForAll();
      logger.info('定时异常检测完成', {
        total: result.total,
        found: result.found,
      });
    } catch (err) {
      logger.error('定时异常检测失败', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  const budgetAlertTask = cron.schedule(BUDGET_ALERT_CRON, async () => {
    try {
      const result = await checkBudgetAlertsForAll();
      logger.info('定时预算告警检测完成', {
        total: result.total,
        alerted: result.alerted,
      });
    } catch (err) {
      logger.error('定时预算告警检测失败', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  const notificationRetryTask = cron.schedule(NOTIFICATION_RETRY_CRON, async () => {
    try {
      const result = await retryFailedDeliveries();
      logger.info('定时通知投递重试完成', {
        retried: result.retried,
        succeeded: result.succeeded,
      });
    } catch (err) {
      logger.error('定时通知投递重试失败', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  scheduledJobs = [
    { name: '净值快照', task: netWorthTask },
    { name: '账单同步', task: syncTask },
    { name: '异常检测', task: anomalyTask },
    { name: '预算告警', task: budgetAlertTask },
    { name: '通知投递重试', task: notificationRetryTask },
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

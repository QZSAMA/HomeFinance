import cron, { ScheduledTask } from 'node-cron';
import { syncAllActiveSources } from '../services/syncService';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('scheduler');

const CRON_EXPRESSION = '0 2 * * *';

let scheduledTask: ScheduledTask | null = null;

/**
 * 初始化定时任务调度器。
 * 每日凌晨 2:00 执行 syncAllActiveSources。
 * 通过环境变量 ENABLE_SCHEDULER 控制（默认 true，设为 false 禁用）。
 * 多次调用幂等：已存在任务时不重复注册。
 */
export function initScheduler(): void {
  if (scheduledTask) {
    return;
  }

  const enabled = process.env.ENABLE_SCHEDULER !== 'false';
  if (!enabled) {
    logger.info('定时调度器已通过 ENABLE_SCHEDULER=false 禁用');
    return;
  }

  scheduledTask = cron.schedule(CRON_EXPRESSION, async () => {
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

  logger.info('定时调度器已初始化', { cron: CRON_EXPRESSION });
}

/**
 * 停止定时任务调度器。
 */
export function stopScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }
}

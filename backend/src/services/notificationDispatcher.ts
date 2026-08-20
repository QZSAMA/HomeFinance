// V4.4 通知分发服务
// 告警产生后查询家庭成员偏好，按渠道（站内/邮件/Web Push）分发并记录投递状态；
// 支持按家庭批量分发与失败投递定时重试。

import type { AnomalyAlert, Family } from '@prisma/client';
import { prisma } from '../app';
import { createModuleLogger } from '../utils/logger';
import { shouldNotify } from './notificationPreferenceService';
import { sendEmail } from './channels/emailChannel';
import type {
  ChannelMessage,
  ChannelRecipient,
  ChannelResult,
} from './channels/emailChannel';
import { sendPush } from './channels/pushChannel';
import type { PushRecipient } from './channels/pushChannel';
import { isEmailConfigured, isPushConfigured } from '../config/notification';

const logger = createModuleLogger('notificationDispatcher');

// 重试窗口：只重试 24 小时内创建的失败投递
const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
// 单批重试上限
const RETRY_BATCH_SIZE = 50;

export type AnomalyAlertWithFamily = AnomalyAlert & { family: Family };

export interface DeliveryOutcome {
  userId: string;
  channel: string;
  status: 'SENT' | 'FAILED' | 'SKIPPED';
  errorMessage?: string;
}

export interface DispatchResult {
  alertId: string;
  deliveries: DeliveryOutcome[];
}

/** 投递时告警快照（写入 NotificationDelivery.alertSnapshot） */
function buildAlertSnapshot(alert: AnomalyAlertWithFamily) {
  return {
    title: alert.title,
    description: alert.description,
    amount: alert.amount != null ? Number(alert.amount) : null,
    severity: alert.severity,
    type: alert.type,
    category: alert.category,
    alertId: alert.id,
    familyId: alert.familyId,
    createdAt: alert.createdAt.toISOString(),
  };
}

/** 渠道消息（传给 emailChannel / pushChannel） */
function buildChannelMessage(alert: AnomalyAlertWithFamily): ChannelMessage {
  return {
    alertType: alert.type,
    severity: alert.severity,
    title: alert.title,
    description: alert.description,
    amount: alert.amount != null ? Number(alert.amount) : undefined,
    category: alert.category ?? undefined,
    familyId: alert.familyId,
    familyName: alert.family.name,
    alertId: alert.id,
    createdAt: alert.createdAt,
  };
}

function toPushRecipient(
  recipient: ChannelRecipient,
  subscriptions: Array<{ id: string; endpoint: string; p256dh: string; auth: string }>
): PushRecipient {
  return {
    ...recipient,
    pushSubscriptions: subscriptions.map((s) => ({
      id: s.id,
      endpoint: s.endpoint,
      p256dh: s.p256dh,
      auth: s.auth,
    })),
  };
}

/** 写入一条投递记录并返回结果摘要；写入失败时降级为 FAILED 结果，不抛错。 */
async function recordDelivery(
  alert: AnomalyAlertWithFamily,
  userId: string,
  channel: string,
  result: ChannelResult,
  alertSnapshot: ReturnType<typeof buildAlertSnapshot>
): Promise<DeliveryOutcome> {
  const outcome: DeliveryOutcome = {
    userId,
    channel,
    status: result.status,
    ...(result.errorMessage !== undefined ? { errorMessage: result.errorMessage } : {}),
  };

  try {
    await prisma.notificationDelivery.create({
      data: {
        alertId: alert.id,
        userId,
        familyId: alert.familyId,
        channel,
        status: result.status,
        errorMessage: result.errorMessage ?? null,
        alertSnapshot,
        sentAt: result.status === 'SENT' ? new Date() : null,
      },
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error('写入投递记录失败', { alertId: alert.id, userId, channel, error: errorMessage });
    return { userId, channel, status: 'FAILED', errorMessage };
  }

  return outcome;
}

/** 对单个成员按偏好投递各渠道（severity 过滤、去重、单渠道失败隔离）。 */
async function dispatchToMember(
  alert: AnomalyAlertWithFamily,
  member: { userId: string; user: { id: string; email: string; name: string } }
): Promise<DeliveryOutcome[]> {
  const prefs = await shouldNotify(member.userId, alert.familyId, alert.type, alert.severity);
  // severity 低于用户阈值（或全部渠道关闭）：该用户不投递
  if (!prefs.inApp && !prefs.email && !prefs.push) {
    return [];
  }

  // 去重：已有同 (alertId, userId, channel) 记录的渠道跳过
  const existing = await prisma.notificationDelivery.findMany({
    where: { alertId: alert.id, userId: member.userId },
  });
  const deliveredChannels = new Set(existing.map((d) => d.channel));

  const alertSnapshot = buildAlertSnapshot(alert);
  const message = buildChannelMessage(alert);
  const recipient: ChannelRecipient = {
    userId: member.userId,
    email: member.user.email,
    name: member.user.name,
  };
  const outcomes: DeliveryOutcome[] = [];

  // 站内：无需异步发送，直接写 SENT
  if (prefs.inApp && !deliveredChannels.has('IN_APP')) {
    outcomes.push(
      await recordDelivery(alert, member.userId, 'IN_APP', { status: 'SENT' }, alertSnapshot)
    );
  }

  // 邮件
  if (prefs.email && !deliveredChannels.has('EMAIL')) {
    let result: ChannelResult;
    try {
      result = isEmailConfigured()
        ? await sendEmail(recipient, message)
        : { status: 'SKIPPED', errorMessage: 'SMTP 未配置' };
    } catch (err) {
      result = {
        status: 'FAILED',
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
    outcomes.push(await recordDelivery(alert, member.userId, 'EMAIL', result, alertSnapshot));
  }

  // Web Push
  if (prefs.push && !deliveredChannels.has('WEB_PUSH')) {
    let result: ChannelResult;
    try {
      if (!isPushConfigured()) {
        result = { status: 'SKIPPED', errorMessage: 'VAPID 未配置' };
      } else {
        const subscriptions = await prisma.pushSubscription.findMany({
          where: { userId: member.userId },
        });
        result = await sendPush(toPushRecipient(recipient, subscriptions), message);
      }
    } catch (err) {
      result = {
        status: 'FAILED',
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
    outcomes.push(await recordDelivery(alert, member.userId, 'WEB_PUSH', result, alertSnapshot));
  }

  return outcomes;
}

/**
 * 对单条告警分发给家庭所有成员：
 * 每个成员先经偏好/severity 过滤，再按渠道去重后投递；
 * 单成员/单渠道失败不中断其他投递。
 */
export async function dispatchAlert(
  alert: AnomalyAlertWithFamily
): Promise<DispatchResult> {
  const members = await prisma.familyMember.findMany({
    where: { familyId: alert.familyId },
    include: { user: true },
  });

  if (members.length === 0) {
    return { alertId: alert.id, deliveries: [] };
  }

  const results = await Promise.all(
    members.map(async (member) => {
      try {
        return await dispatchToMember(alert, member);
      } catch (err) {
        logger.error('成员通知分发失败', {
          alertId: alert.id,
          userId: member.userId,
          error: err instanceof Error ? err.message : String(err),
        });
        return [];
      }
    })
  );

  return { alertId: alert.id, deliveries: results.flat() };
}

/**
 * 对某家庭所有未分发告警（无任何投递记录的告警）执行分发。
 */
export async function dispatchAlertForFamily(
  familyId: string
): Promise<DispatchResult[]> {
  const alerts = await prisma.anomalyAlert.findMany({
    where: { familyId, deliveries: { none: {} } },
    include: { family: true },
  });

  const results: DispatchResult[] = [];
  for (const alert of alerts) {
    try {
      results.push(await dispatchAlert(alert));
    } catch (err) {
      logger.error('告警通知分发失败', {
        alertId: alert.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

/**
 * 重试失败的渠道投递（供定时任务调用）：
 * 查询 24h 内 PENDING/FAILED 的 EMAIL/WEB_PUSH 投递（单批 50 条），
 * 重建消息后按原渠道重发（不再查偏好），并更新投递状态。
 */
export async function retryFailedDeliveries(): Promise<{
  retried: number;
  succeeded: number;
}> {
  const since = new Date(Date.now() - RETRY_WINDOW_MS);
  const deliveries = await prisma.notificationDelivery.findMany({
    where: {
      status: { in: ['PENDING', 'FAILED'] },
      channel: { in: ['EMAIL', 'WEB_PUSH'] },
      createdAt: { gt: since },
    },
    take: RETRY_BATCH_SIZE,
  });

  let retried = 0;
  let succeeded = 0;

  for (const delivery of deliveries) {
    const alert = await prisma.anomalyAlert.findUnique({
      where: { id: delivery.alertId },
      include: { family: true },
    });
    const user = await prisma.user.findUnique({ where: { id: delivery.userId } });
    if (!alert || !user) {
      logger.warn('重试投递跳过：告警或用户不存在', { deliveryId: delivery.id });
      continue;
    }

    const message = buildChannelMessage(alert);
    const recipient: ChannelRecipient = {
      userId: user.id,
      email: user.email,
      name: user.name,
    };

    let result: ChannelResult;
    try {
      if (delivery.channel === 'EMAIL') {
        result = await sendEmail(recipient, message);
      } else {
        const subscriptions = await prisma.pushSubscription.findMany({
          where: { userId: user.id },
        });
        result = await sendPush(toPushRecipient(recipient, subscriptions), message);
      }
    } catch (err) {
      result = {
        status: 'FAILED',
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
    retried++;

    try {
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: result.status,
          errorMessage: result.errorMessage ?? null,
          sentAt: result.status === 'SENT' ? new Date() : null,
        },
      });
    } catch (err) {
      logger.error('更新投递重试结果失败', {
        deliveryId: delivery.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (result.status === 'SENT') {
      succeeded++;
    }
  }

  return { retried, succeeded };
}

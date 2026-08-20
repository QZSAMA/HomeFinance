import webpush from 'web-push';
import { PUSH_CONFIG } from '../../config/push';
import { prisma } from '../../app';
import { ChannelRecipient, ChannelMessage, ChannelResult } from './emailChannel';

export interface PushRecipient extends ChannelRecipient {
  pushSubscriptions: Array<{ id: string; endpoint: string; p256dh: string; auth: string }>;
}

/** VAPID 详情只需设置一次（模块级标志防止重复设置） */
let vapidDetailsSet = false;

export async function sendPush(
  recipient: PushRecipient,
  message: ChannelMessage
): Promise<ChannelResult> {
  if (!PUSH_CONFIG.vapidPublicKey || !PUSH_CONFIG.vapidPrivateKey) {
    return { status: 'SKIPPED', errorMessage: 'VAPID 未配置' };
  }

  const subscriptions = recipient.pushSubscriptions ?? [];
  if (subscriptions.length === 0) {
    return { status: 'SKIPPED', errorMessage: '无可用推送订阅' };
  }

  if (!vapidDetailsSet) {
    webpush.setVapidDetails(PUSH_CONFIG.subject, PUSH_CONFIG.vapidPublicKey, PUSH_CONFIG.vapidPrivateKey);
    vapidDetailsSet = true;
  }

  const payload = {
    title: message.title,
    body: message.description,
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    tag: `alert-${message.alertId}`,
    data: { alertId: message.alertId, familyId: message.familyId, url: '/alerts' },
    requireInteraction: message.severity === 'HIGH',
  };

  const errors: string[] = [];
  let successCount = 0;

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify(payload)
        );
        successCount += 1;
        try {
          await prisma.pushSubscription.update({
            where: { endpoint: subscription.endpoint },
            data: { lastUsedAt: new Date() },
          });
        } catch {
          // lastUsedAt 更新失败不影响推送结果
        }
      } catch (err) {
        const error = err as Error & { statusCode?: number };
        if (error.statusCode === 410) {
          // endpoint 已失效（410 Gone）：清理数据库中的订阅记录，该订阅视为失败
          try {
            await prisma.pushSubscription.delete({ where: { endpoint: subscription.endpoint } });
          } catch {
            // 清理失败不影响整体结果统计
          }
          errors.push(`订阅已失效(410): ${subscription.endpoint}`);
        } else {
          errors.push(error.message || String(err));
        }
      }
    })
  );

  if (successCount === 0) {
    return { status: 'FAILED', errorMessage: errors.join('; ') };
  }
  if (errors.length > 0) {
    return { status: 'SENT', errorMessage: `部分订阅发送失败: ${errors.join('; ')}` };
  }
  return { status: 'SENT' };
}

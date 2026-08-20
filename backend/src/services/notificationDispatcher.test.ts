/**
 * V4.4 通知分发服务（notificationDispatcher）单元测试
 *
 * Mock 策略：
 * - ../app：mock prisma（familyMember/notificationDelivery/pushSubscription/anomalyAlert/user）
 * - ./notificationPreferenceService：mock shouldNotify（偏好过滤可控）
 * - ./channels/emailChannel、./channels/pushChannel：mock 渠道发送函数
 * - ../config/notification：mock isEmailConfigured/isPushConfigured（渠道配置可控）
 */
jest.mock('../app', () => ({
  prisma: {
    familyMember: {
      findMany: jest.fn(),
    },
    notificationDelivery: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    pushSubscription: {
      findMany: jest.fn(),
    },
    anomalyAlert: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('./notificationPreferenceService', () => ({
  shouldNotify: jest.fn(),
}));

jest.mock('./channels/emailChannel', () => ({
  sendEmail: jest.fn(),
}));

jest.mock('./channels/pushChannel', () => ({
  sendPush: jest.fn(),
}));

jest.mock('../config/notification', () => ({
  NOTIFICATION_CONFIG: {
    appUrl: 'http://localhost:3000',
    emailFrom: 'noreply@homefinance.local',
    maxRetries: 3,
    retryDelayMs: 60_000,
    pollThrottleMs: 60_000,
  },
  isEmailConfigured: jest.fn(),
  isPushConfigured: jest.fn(),
}));

import { prisma } from '../app';
import {
  dispatchAlert,
  dispatchAlertForFamily,
  retryFailedDeliveries,
} from './notificationDispatcher';
import { shouldNotify } from './notificationPreferenceService';
import { sendEmail } from './channels/emailChannel';
import { sendPush } from './channels/pushChannel';
import {
  isEmailConfigured,
  isPushConfigured,
} from '../config/notification';
import type { AnomalyAlert, Family } from '@prisma/client';

const mockedPrisma = prisma as any;
const mockedShouldNotify = shouldNotify as jest.MockedFunction<
  typeof shouldNotify
>;
const mockedSendEmail = sendEmail as jest.MockedFunction<typeof sendEmail>;
const mockedSendPush = sendPush as jest.MockedFunction<typeof sendPush>;
const mockedIsEmailConfigured = isEmailConfigured as jest.MockedFunction<
  typeof isEmailConfigured
>;
const mockedIsPushConfigured = isPushConfigured as jest.MockedFunction<
  typeof isPushConfigured
>;

const NOW = new Date('2026-08-19T10:00:00Z');

type AlertWithFamily = AnomalyAlert & { family: Family };

function makeAlert(overrides: Record<string, unknown> = {}): AlertWithFamily {
  return {
    id: 'alert_1',
    familyId: 'fam_1',
    type: 'LARGE_EXPENSE',
    severity: 'HIGH',
    title: '大额支出提醒',
    description: '单笔支出 1200 元，超过近90天均值 300 元的 3 倍',
    amount: 1200,
    expenseId: 'e1',
    category: '家电',
    isRead: false,
    createdAt: NOW,
    family: {
      id: 'fam_1',
      name: '我的家',
      description: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    ...overrides,
  } as unknown as AlertWithFamily;
}

function makeMember(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fm_1',
    familyId: 'fam_1',
    userId: 'user_1',
    role: 'admin',
    createdAt: NOW,
    user: {
      id: 'user_1',
      email: 'user1@example.com',
      name: '用户一',
    },
    ...overrides,
  };
}

function makeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_1',
    endpoint: 'https://push.example.com/send/sub-1',
    p256dh: 'p256dh-key-1',
    auth: 'auth-key-1',
    ...overrides,
  };
}

function makeDelivery(overrides: Record<string, unknown> = {}) {
  return {
    id: 'nd_1',
    alertId: 'alert_1',
    userId: 'user_1',
    familyId: 'fam_1',
    channel: 'EMAIL',
    status: 'FAILED',
    errorMessage: '旧错误',
    alertSnapshot: {},
    sentAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('notificationDispatcher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.familyMember.findMany.mockResolvedValue([]);
    mockedPrisma.notificationDelivery.findMany.mockResolvedValue([]);
    mockedPrisma.notificationDelivery.create.mockResolvedValue({});
    mockedPrisma.notificationDelivery.update.mockResolvedValue({});
    mockedPrisma.pushSubscription.findMany.mockResolvedValue([]);
    mockedPrisma.anomalyAlert.findMany.mockResolvedValue([]);
    mockedPrisma.anomalyAlert.findUnique.mockResolvedValue(null);
    mockedPrisma.user.findUnique.mockResolvedValue(null);
    mockedShouldNotify.mockResolvedValue({ inApp: false, email: false, push: false });
    mockedSendEmail.mockResolvedValue({ status: 'SENT', messageId: 'msg_1' });
    mockedSendPush.mockResolvedValue({ status: 'SENT' });
    mockedIsEmailConfigured.mockReturnValue(false);
    mockedIsPushConfigured.mockReturnValue(false);
  });

  describe('dispatchAlert', () => {
    test('家庭无成员时返回空 deliveries 且不写投递记录', async () => {
      mockedPrisma.familyMember.findMany.mockResolvedValue([]);

      const result = await dispatchAlert(makeAlert());

      expect(result).toEqual({ alertId: 'alert_1', deliveries: [] });
      expect(mockedPrisma.familyMember.findMany).toHaveBeenCalledWith({
        where: { familyId: 'fam_1' },
        include: { user: true },
      });
      expect(mockedPrisma.notificationDelivery.create).not.toHaveBeenCalled();
    });

    test('severity 被偏好过滤时该用户不产生任何投递', async () => {
      mockedPrisma.familyMember.findMany.mockResolvedValue([makeMember()]);
      mockedShouldNotify.mockResolvedValue({ inApp: false, email: false, push: false });

      const result = await dispatchAlert(makeAlert());

      expect(mockedShouldNotify).toHaveBeenCalledWith(
        'user_1',
        'fam_1',
        'LARGE_EXPENSE',
        'HIGH'
      );
      expect(result.deliveries).toEqual([]);
      expect(mockedPrisma.notificationDelivery.create).not.toHaveBeenCalled();
    });

    test('IN_APP 开启时写入 SENT 投递（含快照与 sentAt）', async () => {
      mockedPrisma.familyMember.findMany.mockResolvedValue([makeMember()]);
      mockedShouldNotify.mockResolvedValue({ inApp: true, email: false, push: false });

      const result = await dispatchAlert(makeAlert());

      expect(result.alertId).toBe('alert_1');
      expect(result.deliveries).toEqual([
        { userId: 'user_1', channel: 'IN_APP', status: 'SENT' },
      ]);
      expect(mockedPrisma.notificationDelivery.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          alertId: 'alert_1',
          userId: 'user_1',
          familyId: 'fam_1',
          channel: 'IN_APP',
          status: 'SENT',
          sentAt: expect.any(Date),
          alertSnapshot: expect.objectContaining({
            title: '大额支出提醒',
            description: '单笔支出 1200 元，超过近90天均值 300 元的 3 倍',
            amount: 1200,
            severity: 'HIGH',
            type: 'LARGE_EXPENSE',
            category: '家电',
            alertId: 'alert_1',
            familyId: 'fam_1',
            createdAt: NOW.toISOString(),
          }),
        }),
      });
    });

    test('email 开启且 SMTP 已配置且发送成功 -> SENT 投递', async () => {
      mockedPrisma.familyMember.findMany.mockResolvedValue([makeMember()]);
      mockedShouldNotify.mockResolvedValue({ inApp: false, email: true, push: false });
      mockedIsEmailConfigured.mockReturnValue(true);

      const result = await dispatchAlert(makeAlert());

      expect(mockedSendEmail).toHaveBeenCalledTimes(1);
      expect(mockedSendEmail).toHaveBeenCalledWith(
        { userId: 'user_1', email: 'user1@example.com', name: '用户一' },
        expect.objectContaining({
          alertType: 'LARGE_EXPENSE',
          severity: 'HIGH',
          title: '大额支出提醒',
          amount: 1200,
          category: '家电',
          familyId: 'fam_1',
          familyName: '我的家',
          alertId: 'alert_1',
          createdAt: NOW,
        })
      );
      expect(mockedPrisma.notificationDelivery.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          channel: 'EMAIL',
          status: 'SENT',
          sentAt: expect.any(Date),
        }),
      });
      expect(result.deliveries).toEqual([
        { userId: 'user_1', channel: 'EMAIL', status: 'SENT' },
      ]);
    });

    test('sendEmail 返回 FAILED -> FAILED 投递并记录 errorMessage', async () => {
      mockedPrisma.familyMember.findMany.mockResolvedValue([makeMember()]);
      mockedShouldNotify.mockResolvedValue({ inApp: false, email: true, push: false });
      mockedIsEmailConfigured.mockReturnValue(true);
      mockedSendEmail.mockResolvedValue({ status: 'FAILED', errorMessage: 'SMTP 拒绝连接' });

      const result = await dispatchAlert(makeAlert());

      expect(mockedPrisma.notificationDelivery.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          channel: 'EMAIL',
          status: 'FAILED',
          errorMessage: 'SMTP 拒绝连接',
        }),
      });
      expect(result.deliveries).toEqual([
        { userId: 'user_1', channel: 'EMAIL', status: 'FAILED', errorMessage: 'SMTP 拒绝连接' },
      ]);
    });

    test('email 开启但 SMTP 未配置 -> SKIPPED 投递且不调用 sendEmail', async () => {
      mockedPrisma.familyMember.findMany.mockResolvedValue([makeMember()]);
      mockedShouldNotify.mockResolvedValue({ inApp: false, email: true, push: false });
      mockedIsEmailConfigured.mockReturnValue(false);

      const result = await dispatchAlert(makeAlert());

      expect(mockedSendEmail).not.toHaveBeenCalled();
      expect(mockedPrisma.notificationDelivery.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          channel: 'EMAIL',
          status: 'SKIPPED',
        }),
      });
      expect(result.deliveries).toEqual([
        { userId: 'user_1', channel: 'EMAIL', status: 'SKIPPED', errorMessage: 'SMTP 未配置' },
      ]);
    });

    test('push 开启且 VAPID 已配置且发送成功 -> SENT 投递', async () => {
      mockedPrisma.familyMember.findMany.mockResolvedValue([makeMember()]);
      mockedShouldNotify.mockResolvedValue({ inApp: false, email: false, push: true });
      mockedIsPushConfigured.mockReturnValue(true);
      const subscription = makeSubscription();
      mockedPrisma.pushSubscription.findMany.mockResolvedValue([subscription]);

      const result = await dispatchAlert(makeAlert());

      expect(mockedPrisma.pushSubscription.findMany).toHaveBeenCalledWith({
        where: { userId: 'user_1' },
      });
      expect(mockedSendPush).toHaveBeenCalledTimes(1);
      expect(mockedSendPush).toHaveBeenCalledWith(
        {
          userId: 'user_1',
          email: 'user1@example.com',
          name: '用户一',
          pushSubscriptions: [subscription],
        },
        expect.objectContaining({
          alertId: 'alert_1',
          familyName: '我的家',
          severity: 'HIGH',
        })
      );
      expect(mockedPrisma.notificationDelivery.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          channel: 'WEB_PUSH',
          status: 'SENT',
          sentAt: expect.any(Date),
        }),
      });
      expect(result.deliveries).toEqual([
        { userId: 'user_1', channel: 'WEB_PUSH', status: 'SENT' },
      ]);
    });

    test('push 开启但 VAPID 未配置 -> SKIPPED 投递且不调用 sendPush', async () => {
      mockedPrisma.familyMember.findMany.mockResolvedValue([makeMember()]);
      mockedShouldNotify.mockResolvedValue({ inApp: false, email: false, push: true });
      mockedIsPushConfigured.mockReturnValue(false);

      const result = await dispatchAlert(makeAlert());

      expect(mockedSendPush).not.toHaveBeenCalled();
      expect(mockedPrisma.pushSubscription.findMany).not.toHaveBeenCalled();
      expect(mockedPrisma.notificationDelivery.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          channel: 'WEB_PUSH',
          status: 'SKIPPED',
        }),
      });
      expect(result.deliveries).toEqual([
        { userId: 'user_1', channel: 'WEB_PUSH', status: 'SKIPPED', errorMessage: 'VAPID 未配置' },
      ]);
    });

    test('已有同 (alertId,userId,channel) 记录时跳过该渠道（去重）', async () => {
      mockedPrisma.familyMember.findMany.mockResolvedValue([makeMember()]);
      mockedShouldNotify.mockResolvedValue({ inApp: true, email: true, push: false });
      // IN_APP 已有记录，EMAIL 无
      mockedPrisma.notificationDelivery.findMany.mockResolvedValue([
        { channel: 'IN_APP' },
      ]);
      mockedIsEmailConfigured.mockReturnValue(true);

      await dispatchAlert(makeAlert());

      expect(mockedPrisma.notificationDelivery.findMany).toHaveBeenCalledWith({
        where: { alertId: 'alert_1', userId: 'user_1' },
      });
      expect(mockedPrisma.notificationDelivery.create).toHaveBeenCalledTimes(1);
      expect(mockedPrisma.notificationDelivery.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ channel: 'EMAIL' }),
      });
    });

    test('sendEmail 抛异常不中断其他渠道（IN_APP 仍写入，EMAIL 记 FAILED）', async () => {
      mockedPrisma.familyMember.findMany.mockResolvedValue([makeMember()]);
      mockedShouldNotify.mockResolvedValue({ inApp: true, email: true, push: false });
      mockedIsEmailConfigured.mockReturnValue(true);
      mockedSendEmail.mockRejectedValue(new Error('SMTP 连接超时'));

      const result = await dispatchAlert(makeAlert());

      expect(mockedPrisma.notificationDelivery.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ channel: 'IN_APP', status: 'SENT' }),
      });
      const emailDelivery = result.deliveries.find((d) => d.channel === 'EMAIL');
      expect(emailDelivery).toMatchObject({
        userId: 'user_1',
        channel: 'EMAIL',
        status: 'FAILED',
        errorMessage: 'SMTP 连接超时',
      });
      expect(mockedPrisma.notificationDelivery.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          channel: 'EMAIL',
          status: 'FAILED',
          errorMessage: 'SMTP 连接超时',
        }),
      });
    });

    test('多成员时聚合所有成员的投递结果', async () => {
      mockedPrisma.familyMember.findMany.mockResolvedValue([
        makeMember(),
        makeMember({
          id: 'fm_2',
          userId: 'user_2',
          user: { id: 'user_2', email: 'user2@example.com', name: '用户二' },
        }),
      ]);
      mockedShouldNotify.mockResolvedValue({ inApp: true, email: false, push: false });

      const result = await dispatchAlert(makeAlert());

      expect(result.deliveries).toHaveLength(2);
      expect(result.deliveries.map((d) => d.userId).sort()).toEqual(['user_1', 'user_2']);
      expect(mockedPrisma.notificationDelivery.create).toHaveBeenCalledTimes(2);
    });

    test('三渠道同时开启时全部投递', async () => {
      mockedPrisma.familyMember.findMany.mockResolvedValue([makeMember()]);
      mockedShouldNotify.mockResolvedValue({ inApp: true, email: true, push: true });
      mockedIsEmailConfigured.mockReturnValue(true);
      mockedIsPushConfigured.mockReturnValue(true);
      mockedPrisma.pushSubscription.findMany.mockResolvedValue([makeSubscription()]);

      const result = await dispatchAlert(makeAlert());

      expect(result.deliveries.map((d) => d.channel).sort()).toEqual([
        'EMAIL',
        'IN_APP',
        'WEB_PUSH',
      ]);
      expect(result.deliveries.every((d) => d.status === 'SENT')).toBe(true);
      expect(mockedPrisma.notificationDelivery.create).toHaveBeenCalledTimes(3);
    });
  });

  describe('dispatchAlertForFamily', () => {
    test('查询无投递记录的告警并逐条分发', async () => {
      mockedPrisma.anomalyAlert.findMany.mockResolvedValue([
        makeAlert({ id: 'alert_1' }),
        makeAlert({ id: 'alert_2' }),
      ]);
      mockedPrisma.familyMember.findMany.mockResolvedValue([makeMember()]);
      mockedShouldNotify.mockResolvedValue({ inApp: true, email: false, push: false });

      const results = await dispatchAlertForFamily('fam_1');

      expect(mockedPrisma.anomalyAlert.findMany).toHaveBeenCalledWith({
        where: { familyId: 'fam_1', deliveries: { none: {} } },
        include: { family: true },
      });
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.alertId)).toEqual(['alert_1', 'alert_2']);
      expect(mockedPrisma.notificationDelivery.create).toHaveBeenCalledTimes(2);
    });

    test('无待分发告警时返回空数组', async () => {
      mockedPrisma.anomalyAlert.findMany.mockResolvedValue([]);

      const results = await dispatchAlertForFamily('fam_1');

      expect(results).toEqual([]);
      expect(mockedPrisma.familyMember.findMany).not.toHaveBeenCalled();
    });
  });

  describe('retryFailedDeliveries', () => {
    test('查询 PENDING/FAILED + EMAIL/WEB_PUSH + 24h 内的投递（take 50）', async () => {
      mockedPrisma.notificationDelivery.findMany.mockResolvedValue([]);

      const result = await retryFailedDeliveries();

      expect(mockedPrisma.notificationDelivery.findMany).toHaveBeenCalledWith({
        where: {
          status: { in: ['PENDING', 'FAILED'] },
          channel: { in: ['EMAIL', 'WEB_PUSH'] },
          createdAt: { gt: expect.any(Date) },
        },
        take: 50,
      });
      expect(result).toEqual({ retried: 0, succeeded: 0 });
    });

    test('重试 EMAIL 成功后更新为 SENT', async () => {
      mockedPrisma.notificationDelivery.findMany.mockResolvedValue([
        makeDelivery({ channel: 'EMAIL' }),
      ]);
      mockedPrisma.anomalyAlert.findUnique.mockResolvedValue(makeAlert());
      mockedPrisma.user.findUnique.mockResolvedValue({
        id: 'user_1',
        email: 'user1@example.com',
        name: '用户一',
      });

      const result = await retryFailedDeliveries();

      expect(mockedPrisma.anomalyAlert.findUnique).toHaveBeenCalledWith({
        where: { id: 'alert_1' },
        include: { family: true },
      });
      expect(mockedSendEmail).toHaveBeenCalledWith(
        { userId: 'user_1', email: 'user1@example.com', name: '用户一' },
        expect.objectContaining({ alertId: 'alert_1', familyName: '我的家' })
      );
      expect(mockedPrisma.notificationDelivery.update).toHaveBeenCalledWith({
        where: { id: 'nd_1' },
        data: expect.objectContaining({
          status: 'SENT',
          sentAt: expect.any(Date),
        }),
      });
      expect(result).toEqual({ retried: 1, succeeded: 1 });
    });

    test('重试 WEB_PUSH 成功后更新为 SENT', async () => {
      mockedPrisma.notificationDelivery.findMany.mockResolvedValue([
        makeDelivery({ channel: 'WEB_PUSH' }),
      ]);
      mockedPrisma.anomalyAlert.findUnique.mockResolvedValue(makeAlert());
      mockedPrisma.user.findUnique.mockResolvedValue({
        id: 'user_1',
        email: 'user1@example.com',
        name: '用户一',
      });
      const subscription = makeSubscription();
      mockedPrisma.pushSubscription.findMany.mockResolvedValue([subscription]);

      const result = await retryFailedDeliveries();

      expect(mockedSendPush).toHaveBeenCalledWith(
        {
          userId: 'user_1',
          email: 'user1@example.com',
          name: '用户一',
          pushSubscriptions: [subscription],
        },
        expect.objectContaining({ alertId: 'alert_1' })
      );
      expect(mockedPrisma.notificationDelivery.update).toHaveBeenCalledWith({
        where: { id: 'nd_1' },
        data: expect.objectContaining({ status: 'SENT' }),
      });
      expect(result).toEqual({ retried: 1, succeeded: 1 });
    });

    test('重试仍失败时更新为 FAILED 且 succeeded 不计', async () => {
      mockedPrisma.notificationDelivery.findMany.mockResolvedValue([
        makeDelivery({ channel: 'EMAIL' }),
      ]);
      mockedPrisma.anomalyAlert.findUnique.mockResolvedValue(makeAlert());
      mockedPrisma.user.findUnique.mockResolvedValue({
        id: 'user_1',
        email: 'user1@example.com',
        name: '用户一',
      });
      mockedSendEmail.mockResolvedValue({ status: 'FAILED', errorMessage: '依然失败' });

      const result = await retryFailedDeliveries();

      expect(mockedPrisma.notificationDelivery.update).toHaveBeenCalledWith({
        where: { id: 'nd_1' },
        data: expect.objectContaining({
          status: 'FAILED',
          errorMessage: '依然失败',
        }),
      });
      expect(result).toEqual({ retried: 1, succeeded: 0 });
    });

    test('告警不存在时跳过该投递', async () => {
      mockedPrisma.notificationDelivery.findMany.mockResolvedValue([
        makeDelivery({ channel: 'EMAIL' }),
      ]);
      mockedPrisma.anomalyAlert.findUnique.mockResolvedValue(null);

      const result = await retryFailedDeliveries();

      expect(mockedSendEmail).not.toHaveBeenCalled();
      expect(mockedPrisma.notificationDelivery.update).not.toHaveBeenCalled();
      expect(result).toEqual({ retried: 0, succeeded: 0 });
    });

    test('用户不存在时跳过该投递', async () => {
      mockedPrisma.notificationDelivery.findMany.mockResolvedValue([
        makeDelivery({ channel: 'EMAIL' }),
      ]);
      mockedPrisma.anomalyAlert.findUnique.mockResolvedValue(makeAlert());
      mockedPrisma.user.findUnique.mockResolvedValue(null);

      const result = await retryFailedDeliveries();

      expect(mockedSendEmail).not.toHaveBeenCalled();
      expect(result).toEqual({ retried: 0, succeeded: 0 });
    });
  });
});

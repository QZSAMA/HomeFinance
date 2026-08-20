/**
 * V4.3 Web Push 通知渠道（pushChannel）单元测试
 *
 * Mock 策略：
 * - web-push：mock sendNotification / setVapidDetails
 * - ../../app：mock prisma.pushSubscription（delete 清理失效订阅 / update lastUsedAt）
 * - PUSH_CONFIG 在模块加载时读取 env，因此用 jest.resetModules() + 动态 require
 *   按当前 process.env 重新加载 pushChannel 获取新实例
 */
jest.mock('web-push', () => ({ sendNotification: jest.fn(), setVapidDetails: jest.fn() }));
jest.mock('../../app', () => ({
  prisma: {
    pushSubscription: {
      delete: jest.fn(),
      update: jest.fn(),
    },
  },
}));

import type { ChannelMessage } from './emailChannel';

const VAPID_PUBLIC_KEY = 'test-vapid-public-key';
const VAPID_PRIVATE_KEY = 'test-vapid-private-key';
const VAPID_SUBJECT = 'mailto:admin@homefinance.local';

interface TestSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

let sendPush: typeof import('./pushChannel').sendPush;
let mockedSendNotification: jest.Mock;
let mockedSetVapidDetails: jest.Mock;
let mockedDelete: jest.Mock;
let mockedUpdate: jest.Mock;

/** 重置模块并按当前 process.env 重新加载 pushChannel（PUSH_CONFIG 读取 import 时的 env） */
function loadPushChannel(): void {
  jest.resetModules();
  ({ sendPush } = require('./pushChannel'));
  const webpushMock = require('web-push') as {
    sendNotification: jest.Mock;
    setVapidDetails: jest.Mock;
  };
  mockedSendNotification = webpushMock.sendNotification;
  mockedSetVapidDetails = webpushMock.setVapidDetails;
  const prismaMock = require('../../app') as {
    prisma: { pushSubscription: { delete: jest.Mock; update: jest.Mock } };
  };
  mockedDelete = prismaMock.prisma.pushSubscription.delete;
  mockedUpdate = prismaMock.prisma.pushSubscription.update;
}

function makeSubscription(overrides: Partial<TestSubscription> = {}): TestSubscription {
  return {
    id: 'sub_1',
    endpoint: 'https://push.example.com/send/sub-1',
    p256dh: 'p256dh-key-1',
    auth: 'auth-key-1',
    ...overrides,
  };
}

function makeRecipient(subscriptions: TestSubscription[] = []) {
  return {
    userId: 'user_1',
    email: 'user@example.com',
    name: '测试用户',
    pushSubscriptions: subscriptions,
  };
}

function makeMessage(overrides: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    alertType: 'LARGE_EXPENSE',
    severity: 'HIGH',
    title: '发现大额支出',
    description: '今日出现一笔超出常规的支出',
    amount: 999,
    category: '餐饮',
    familyId: 'fam_1',
    familyName: '我的家',
    alertId: 'alert_1',
    createdAt: new Date('2026-08-19T10:00:00Z'),
    ...overrides,
  };
}

describe('pushChannel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.VAPID_PUBLIC_KEY = VAPID_PUBLIC_KEY;
    process.env.VAPID_PRIVATE_KEY = VAPID_PRIVATE_KEY;
    process.env.VAPID_SUBJECT = VAPID_SUBJECT;
    loadPushChannel();
  });

  afterAll(() => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
  });

  describe('VAPID 未配置', () => {
    test('缺少公钥 -> SKIPPED，不调用 sendNotification', async () => {
      delete process.env.VAPID_PUBLIC_KEY;
      loadPushChannel();

      const result = await sendPush(makeRecipient([makeSubscription()]), makeMessage());

      expect(result.status).toBe('SKIPPED');
      expect(result.errorMessage).toBe('VAPID 未配置');
      expect(mockedSendNotification).not.toHaveBeenCalled();
      expect(mockedSetVapidDetails).not.toHaveBeenCalled();
    });

    test('缺少私钥 -> SKIPPED，不调用 sendNotification', async () => {
      delete process.env.VAPID_PRIVATE_KEY;
      loadPushChannel();

      const result = await sendPush(makeRecipient([makeSubscription()]), makeMessage());

      expect(result.status).toBe('SKIPPED');
      expect(result.errorMessage).toBe('VAPID 未配置');
      expect(mockedSendNotification).not.toHaveBeenCalled();
    });
  });

  test('无推送订阅 -> SKIPPED', async () => {
    const result = await sendPush(makeRecipient([]), makeMessage());

    expect(result.status).toBe('SKIPPED');
    expect(mockedSendNotification).not.toHaveBeenCalled();
  });

  test('单订阅发送成功 -> SENT', async () => {
    mockedSendNotification.mockResolvedValueOnce({ statusCode: 201 });

    const result = await sendPush(makeRecipient([makeSubscription()]), makeMessage());

    expect(result.status).toBe('SENT');
  });

  test('多订阅部分成功 -> SENT，sendNotification 调用次数等于订阅数，并记录失败原因', async () => {
    mockedSendNotification
      .mockResolvedValueOnce({ statusCode: 201 })
      .mockRejectedValueOnce(new Error('network timeout'));

    const result = await sendPush(
      makeRecipient([
        makeSubscription({ id: 'sub_1', endpoint: 'https://push.example.com/send/sub-1' }),
        makeSubscription({ id: 'sub_2', endpoint: 'https://push.example.com/send/sub-2' }),
      ]),
      makeMessage()
    );

    expect(result.status).toBe('SENT');
    expect(mockedSendNotification).toHaveBeenCalledTimes(2);
    expect(result.errorMessage).toContain('network timeout');
  });

  test('全部订阅失败 -> FAILED 且 errorMessage 合并错误信息', async () => {
    mockedSendNotification
      .mockRejectedValueOnce(new Error('push error 1'))
      .mockRejectedValueOnce(new Error('push error 2'));

    const result = await sendPush(
      makeRecipient([
        makeSubscription({ id: 'sub_1', endpoint: 'https://push.example.com/send/sub-1' }),
        makeSubscription({ id: 'sub_2', endpoint: 'https://push.example.com/send/sub-2' }),
      ]),
      makeMessage()
    );

    expect(result.status).toBe('FAILED');
    expect(result.errorMessage).toContain('push error 1');
    expect(result.errorMessage).toContain('push error 2');
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  test('410 Gone -> 删除失效订阅记录（正确的 endpoint），唯一订阅时最终 FAILED', async () => {
    const goneError = Object.assign(new Error('Received unexpected status code 410'), {
      statusCode: 410,
    });
    mockedSendNotification.mockRejectedValueOnce(goneError);

    const result = await sendPush(
      makeRecipient([makeSubscription({ endpoint: 'https://push.example.com/send/gone' })]),
      makeMessage()
    );

    expect(mockedDelete).toHaveBeenCalledTimes(1);
    expect(mockedDelete).toHaveBeenCalledWith({
      where: { endpoint: 'https://push.example.com/send/gone' },
    });
    expect(result.status).toBe('FAILED');
    expect(result.errorMessage).toBeTruthy();
  });

  describe('payload 结构', () => {
    test('severity=HIGH -> payload 字段完整、requireInteraction=true，订阅参数含 keys', async () => {
      mockedSendNotification.mockResolvedValueOnce({ statusCode: 201 });
      const subscription = makeSubscription();

      await sendPush(makeRecipient([subscription]), makeMessage({ severity: 'HIGH' }));

      expect(mockedSendNotification).toHaveBeenCalledTimes(1);
      const [subscriptionArg, payloadArg] = mockedSendNotification.mock.calls[0];
      expect(subscriptionArg).toEqual({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      });
      const payload = JSON.parse(payloadArg);
      expect(payload.title).toBe('发现大额支出');
      expect(payload.body).toBe('今日出现一笔超出常规的支出');
      expect(payload.icon).toBe('/icon-192.png');
      expect(payload.badge).toBe('/badge-72.png');
      expect(payload.tag).toBe('alert-alert_1');
      expect(payload.data).toEqual({ alertId: 'alert_1', familyId: 'fam_1', url: '/alerts' });
      expect(payload.requireInteraction).toBe(true);
    });

    test('severity=MEDIUM -> requireInteraction=false', async () => {
      mockedSendNotification.mockResolvedValueOnce({ statusCode: 201 });

      await sendPush(makeRecipient([makeSubscription()]), makeMessage({ severity: 'MEDIUM' }));

      const payload = JSON.parse(mockedSendNotification.mock.calls[0][1]);
      expect(payload.requireInteraction).toBe(false);
    });
  });

  test('发送成功的订阅更新 lastUsedAt', async () => {
    mockedSendNotification.mockResolvedValueOnce({ statusCode: 201 });
    const subscription = makeSubscription();

    await sendPush(makeRecipient([subscription]), makeMessage());

    expect(mockedUpdate).toHaveBeenCalledTimes(1);
    expect(mockedUpdate).toHaveBeenCalledWith({
      where: { endpoint: subscription.endpoint },
      data: { lastUsedAt: expect.any(Date) },
    });
  });

  test('setVapidDetails 仅首次调用，参数含 subject/publicKey/privateKey', async () => {
    mockedSendNotification.mockResolvedValue({ statusCode: 201 });

    await sendPush(makeRecipient([makeSubscription()]), makeMessage());
    await sendPush(makeRecipient([makeSubscription()]), makeMessage());

    expect(mockedSetVapidDetails).toHaveBeenCalledTimes(1);
    expect(mockedSetVapidDetails).toHaveBeenCalledWith(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  });
});

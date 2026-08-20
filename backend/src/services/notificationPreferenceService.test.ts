jest.mock('../app', () => ({
  prisma: {
    notificationPreference: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
    },
    pushSubscription: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

import { prisma } from '../app';
import {
  ALERT_TYPES,
  SEVERITIES,
  getOrCreatePreferences,
  updatePreferences,
  shouldNotify,
} from './notificationPreferenceService';

const mockedPrisma = prisma as any;

function makePreference(overrides: { alertType: string } & Record<string, unknown>) {
  return {
    id: `pref_${overrides.alertType}`,
    userId: 'user_1',
    familyId: 'fam_1',
    minSeverity: 'LOW',
    inAppEnabled: true,
    emailEnabled: false,
    pushEnabled: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('notificationPreferenceService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.notificationPreference.create.mockImplementation(({ data }: any) =>
      Promise.resolve(makePreference({ ...data }))
    );
    mockedPrisma.notificationPreference.upsert.mockImplementation(({ create: createData }: any) =>
      Promise.resolve(makePreference({ ...createData }))
    );
  });

  describe('常量', () => {
    test('ALERT_TYPES 包含 7 种告警类型', () => {
      expect(ALERT_TYPES).toEqual([
        'LARGE_EXPENSE',
        'FREQUENCY_SPIKE',
        'CATEGORY_SURGE',
        'DUPLICATE',
        'BUDGET_EXCEEDED',
        'BUDGET_WARNING',
        'SYSTEM',
      ]);
    });

    test('SEVERITIES 包含 3 种严重度', () => {
      expect(SEVERITIES).toEqual(['HIGH', 'MEDIUM', 'LOW']);
    });
  });

  describe('getOrCreatePreferences', () => {
    test('已有全部 7 种记录时直接返回，不创建', async () => {
      const existing = ALERT_TYPES.map((alertType) => makePreference({ alertType }));
      mockedPrisma.notificationPreference.findMany.mockResolvedValue(existing);

      const result = await getOrCreatePreferences('user_1', 'fam_1');

      expect(result).toHaveLength(7);
      expect(mockedPrisma.notificationPreference.findMany).toHaveBeenCalledWith({
        where: { userId: 'user_1', familyId: 'fam_1' },
      });
      expect(mockedPrisma.notificationPreference.create).not.toHaveBeenCalled();
    });

    test('部分缺失时只为缺失的类型创建默认记录', async () => {
      // 已存在 3 种，缺 4 种
      const existing = ['LARGE_EXPENSE', 'DUPLICATE', 'BUDGET_WARNING'].map((alertType) =>
        makePreference({ alertType })
      );
      mockedPrisma.notificationPreference.findMany.mockResolvedValue(existing);

      const result = await getOrCreatePreferences('user_1', 'fam_1');

      expect(result).toHaveLength(7);
      expect(mockedPrisma.notificationPreference.create).toHaveBeenCalledTimes(4);
      // 每次创建只传 userId/familyId/alertType，其余走 schema 默认值
      const createdTypes = mockedPrisma.notificationPreference.create.mock.calls.map(
        (call: any[]) => call[0].data.alertType
      );
      expect(createdTypes).toEqual(
        expect.arrayContaining(['FREQUENCY_SPIKE', 'CATEGORY_SURGE', 'BUDGET_EXCEEDED', 'SYSTEM'])
      );
      expect(createdTypes).not.toContain('LARGE_EXPENSE');
      expect(mockedPrisma.notificationPreference.create).toHaveBeenCalledWith({
        data: {
          userId: 'user_1',
          familyId: 'fam_1',
          alertType: 'FREQUENCY_SPIKE',
        },
      });
    });

    test('无任何记录时创建全部 7 种默认记录', async () => {
      mockedPrisma.notificationPreference.findMany.mockResolvedValue([]);

      const result = await getOrCreatePreferences('user_1', 'fam_1');

      expect(result).toHaveLength(7);
      expect(mockedPrisma.notificationPreference.create).toHaveBeenCalledTimes(7);
    });
  });

  describe('updatePreferences', () => {
    test('合法输入按 alertType upsert 并返回更新后列表', async () => {
      const input = [
        {
          alertType: 'LARGE_EXPENSE',
          minSeverity: 'HIGH',
          inAppEnabled: true,
          emailEnabled: true,
          pushEnabled: false,
        },
        {
          alertType: 'BUDGET_EXCEEDED',
          minSeverity: 'MEDIUM',
          inAppEnabled: false,
          emailEnabled: false,
          pushEnabled: true,
        },
      ];

      const result = await updatePreferences('user_1', 'fam_1', input);

      expect(result).toHaveLength(2);
      expect(mockedPrisma.notificationPreference.upsert).toHaveBeenCalledTimes(2);
      expect(mockedPrisma.notificationPreference.upsert).toHaveBeenCalledWith({
        where: {
          userId_familyId_alertType: {
            userId: 'user_1',
            familyId: 'fam_1',
            alertType: 'LARGE_EXPENSE',
          },
        },
        create: {
          userId: 'user_1',
          familyId: 'fam_1',
          alertType: 'LARGE_EXPENSE',
          minSeverity: 'HIGH',
          inAppEnabled: true,
          emailEnabled: true,
          pushEnabled: false,
        },
        update: {
          minSeverity: 'HIGH',
          inAppEnabled: true,
          emailEnabled: true,
          pushEnabled: false,
        },
      });
    });

    test('非法 alertType 抛错且不执行 upsert', async () => {
      await expect(
        updatePreferences('user_1', 'fam_1', [
          {
            alertType: 'INVALID_TYPE',
            minSeverity: 'LOW',
            inAppEnabled: true,
            emailEnabled: false,
            pushEnabled: false,
          },
        ])
      ).rejects.toThrow('非法的告警类型');

      expect(mockedPrisma.notificationPreference.upsert).not.toHaveBeenCalled();
    });

    test('非法 minSeverity 抛错且不执行 upsert', async () => {
      await expect(
        updatePreferences('user_1', 'fam_1', [
          {
            alertType: 'DUPLICATE',
            minSeverity: 'CRITICAL',
            inAppEnabled: true,
            emailEnabled: false,
            pushEnabled: false,
          },
        ])
      ).rejects.toThrow('非法的严重度');

      expect(mockedPrisma.notificationPreference.upsert).not.toHaveBeenCalled();
    });
  });

  describe('shouldNotify', () => {
    test('无偏好记录时返回默认值（仅站内开启）', async () => {
      mockedPrisma.notificationPreference.findUnique.mockResolvedValue(null);

      const result = await shouldNotify('user_1', 'fam_1', 'LARGE_EXPENSE', 'LOW');

      expect(result).toEqual({ inApp: true, email: false, push: false });
      expect(mockedPrisma.notificationPreference.findUnique).toHaveBeenCalledWith({
        where: {
          userId_familyId_alertType: {
            userId: 'user_1',
            familyId: 'fam_1',
            alertType: 'LARGE_EXPENSE',
          },
        },
      });
    });

    test('severity 低于 minSeverity 时所有渠道均不投递', async () => {
      mockedPrisma.notificationPreference.findUnique.mockResolvedValue(
        makePreference({
          alertType: 'LARGE_EXPENSE',
          minSeverity: 'MEDIUM',
          inAppEnabled: true,
          emailEnabled: true,
          pushEnabled: true,
        })
      );

      const result = await shouldNotify('user_1', 'fam_1', 'LARGE_EXPENSE', 'LOW');

      expect(result).toEqual({ inApp: false, email: false, push: false });
    });

    test('emailEnabled=true 且 severity 达标时 email=true', async () => {
      mockedPrisma.notificationPreference.findUnique.mockResolvedValue(
        makePreference({
          alertType: 'LARGE_EXPENSE',
          minSeverity: 'LOW',
          inAppEnabled: true,
          emailEnabled: true,
          pushEnabled: false,
        })
      );

      const result = await shouldNotify('user_1', 'fam_1', 'LARGE_EXPENSE', 'HIGH');

      expect(result).toEqual({ inApp: true, email: true, push: false });
    });

    test('pushEnabled=true 且 severity 达标时 push=true', async () => {
      mockedPrisma.notificationPreference.findUnique.mockResolvedValue(
        makePreference({
          alertType: 'BUDGET_EXCEEDED',
          minSeverity: 'LOW',
          inAppEnabled: false,
          emailEnabled: false,
          pushEnabled: true,
        })
      );

      const result = await shouldNotify('user_1', 'fam_1', 'BUDGET_EXCEEDED', 'MEDIUM');

      expect(result).toEqual({ inApp: false, email: false, push: true });
    });

    describe('severity 优先级 HIGH > MEDIUM > LOW', () => {
      beforeEach(() => {
        mockedPrisma.notificationPreference.findUnique.mockResolvedValue(
          makePreference({
            alertType: 'LARGE_EXPENSE',
            minSeverity: 'MEDIUM',
            inAppEnabled: true,
            emailEnabled: true,
            pushEnabled: true,
          })
        );
      });

      test('minSeverity=MEDIUM 时 HIGH 通过', async () => {
        const result = await shouldNotify('user_1', 'fam_1', 'LARGE_EXPENSE', 'HIGH');
        expect(result).toEqual({ inApp: true, email: true, push: true });
      });

      test('minSeverity=MEDIUM 时 MEDIUM 通过', async () => {
        const result = await shouldNotify('user_1', 'fam_1', 'LARGE_EXPENSE', 'MEDIUM');
        expect(result).toEqual({ inApp: true, email: true, push: true });
      });

      test('minSeverity=MEDIUM 时 LOW 不通过', async () => {
        const result = await shouldNotify('user_1', 'fam_1', 'LARGE_EXPENSE', 'LOW');
        expect(result).toEqual({ inApp: false, email: false, push: false });
      });
    });
  });
});

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import notificationPreferenceRoutes from './notificationPreferences';

jest.mock('../app', () => ({
  prisma: {
    familyMember: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('../services/notificationPreferenceService', () => ({
  ALERT_TYPES: [
    'LARGE_EXPENSE',
    'FREQUENCY_SPIKE',
    'CATEGORY_SURGE',
    'DUPLICATE',
    'BUDGET_EXCEEDED',
    'BUDGET_WARNING',
    'SYSTEM',
  ],
  SEVERITIES: ['HIGH', 'MEDIUM', 'LOW'],
  getOrCreatePreferences: jest.fn(),
  updatePreferences: jest.fn(),
}));

import { prisma } from '../app';
import {
  getOrCreatePreferences,
  updatePreferences,
} from '../services/notificationPreferenceService';

const mockedPrisma = prisma as any;
const mockedGetOrCreate = getOrCreatePreferences as jest.MockedFunction<
  typeof getOrCreatePreferences
>;
const mockedUpdate = updatePreferences as jest.MockedFunction<typeof updatePreferences>;

const app = express();
app.use(express.json());
app.use('/api/families/:familyId/notification-preferences', notificationPreferenceRoutes);

function createToken(userId: string = 'user_1') {
  return jwt.sign(
    { userId, email: 'test@example.com', name: 'Test User' },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' }
  );
}

function makePreference(alertType: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `pref_${alertType}`,
    userId: 'user_1',
    familyId: 'fam_1',
    alertType,
    minSeverity: 'LOW',
    inAppEnabled: true,
    emailEnabled: false,
    pushEnabled: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('Notification Preference Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.familyMember.findUnique.mockResolvedValue({
      familyId: 'fam_1',
      userId: 'user_1',
      role: 'admin',
    });
    mockedGetOrCreate.mockResolvedValue([makePreference('LARGE_EXPENSE')]);
    mockedUpdate.mockResolvedValue([makePreference('LARGE_EXPENSE')]);
  });

  describe('GET /api/families/:familyId/notification-preferences', () => {
    test('返回当前用户偏好列表', async () => {
      const preferences = [
        makePreference('LARGE_EXPENSE'),
        makePreference('DUPLICATE', { minSeverity: 'HIGH' }),
      ];
      mockedGetOrCreate.mockResolvedValue(preferences);

      const res = await request(app)
        .get('/api/families/fam_1/notification-preferences')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.preferences).toHaveLength(2);
      expect(res.body.preferences[0].alertType).toBe('LARGE_EXPENSE');
      expect(mockedGetOrCreate).toHaveBeenCalledWith('user_1', 'fam_1');
    });

    test('非家庭成员返回 403', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/families/fam_1/notification-preferences')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(403);
      expect(mockedGetOrCreate).not.toHaveBeenCalled();
    });

    test('未认证返回 401', async () => {
      const res = await request(app).get('/api/families/fam_1/notification-preferences');

      expect(res.status).toBe(401);
    });
  });

  describe('PUT /api/families/:familyId/notification-preferences', () => {
    test('合法 body 批量更新成功', async () => {
      const updated = [
        makePreference('LARGE_EXPENSE', { minSeverity: 'HIGH', emailEnabled: true }),
      ];
      mockedUpdate.mockResolvedValue(updated);

      const res = await request(app)
        .put('/api/families/fam_1/notification-preferences')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({
          preferences: [
            {
              alertType: 'LARGE_EXPENSE',
              minSeverity: 'HIGH',
              inAppEnabled: true,
              emailEnabled: true,
              pushEnabled: false,
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.preferences).toHaveLength(1);
      expect(res.body.preferences[0].minSeverity).toBe('HIGH');
      expect(mockedUpdate).toHaveBeenCalledWith('user_1', 'fam_1', [
        {
          alertType: 'LARGE_EXPENSE',
          minSeverity: 'HIGH',
          inAppEnabled: true,
          emailEnabled: true,
          pushEnabled: false,
        },
      ]);
    });

    test('非法 alertType 返回 400', async () => {
      const res = await request(app)
        .put('/api/families/fam_1/notification-preferences')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({
          preferences: [
            {
              alertType: 'INVALID_TYPE',
              minSeverity: 'LOW',
              inAppEnabled: true,
              emailEnabled: false,
              pushEnabled: false,
            },
          ],
        });

      expect(res.status).toBe(400);
      expect(mockedUpdate).not.toHaveBeenCalled();
    });

    test('非法 minSeverity 返回 400', async () => {
      const res = await request(app)
        .put('/api/families/fam_1/notification-preferences')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({
          preferences: [
            {
              alertType: 'DUPLICATE',
              minSeverity: 'CRITICAL',
              inAppEnabled: true,
              emailEnabled: false,
              pushEnabled: false,
            },
          ],
        });

      expect(res.status).toBe(400);
      expect(mockedUpdate).not.toHaveBeenCalled();
    });

    test('body 缺 preferences 字段返回 400', async () => {
      const res = await request(app)
        .put('/api/families/fam_1/notification-preferences')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({});

      expect(res.status).toBe(400);
      expect(mockedUpdate).not.toHaveBeenCalled();
    });

    test('非家庭成员返回 403', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .put('/api/families/fam_1/notification-preferences')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({
          preferences: [
            {
              alertType: 'LARGE_EXPENSE',
              minSeverity: 'LOW',
              inAppEnabled: true,
              emailEnabled: false,
              pushEnabled: false,
            },
          ],
        });

      expect(res.status).toBe(403);
      expect(mockedUpdate).not.toHaveBeenCalled();
    });
  });
});

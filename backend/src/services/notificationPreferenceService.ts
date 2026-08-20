import { NotificationPreference } from '@prisma/client';
import { prisma } from '../app';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('notificationPreferenceService');

// 支持的告警类型（与 AnomalyAlert.type 对齐，另加 SYSTEM 系统通知）
export const ALERT_TYPES = [
  'LARGE_EXPENSE',
  'FREQUENCY_SPIKE',
  'CATEGORY_SURGE',
  'DUPLICATE',
  'BUDGET_EXCEEDED',
  'BUDGET_WARNING',
  'SYSTEM',
] as const;

// 支持的严重度
export const SEVERITIES = ['HIGH', 'MEDIUM', 'LOW'] as const;

export type AlertType = (typeof ALERT_TYPES)[number];
export type Severity = (typeof SEVERITIES)[number];

// 偏好更新输入（按 alertType 匹配）
export interface PreferenceInput {
  alertType: string;
  minSeverity: string;
  inAppEnabled: boolean;
  emailEnabled: boolean;
  pushEnabled: boolean;
}

// severity 优先级：HIGH > MEDIUM > LOW
const SEVERITY_ORDER: Record<string, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

function meetsSeverity(severity: string, minSeverity: string): boolean {
  return (
    (SEVERITY_ORDER[severity] ?? 0) >= (SEVERITY_ORDER[minSeverity] ?? 0)
  );
}

export function isValidAlertType(value: string): value is AlertType {
  return (ALERT_TYPES as readonly string[]).includes(value);
}

export function isValidSeverity(value: string): value is Severity {
  return (SEVERITIES as readonly string[]).includes(value);
}

/**
 * 惰性创建/获取用户在某家庭的全部偏好：
 * 已存在的记录直接返回，缺失的类型按默认值创建
 * （inAppEnabled=true, emailEnabled=false, pushEnabled=false, minSeverity=LOW）。
 */
export async function getOrCreatePreferences(
  userId: string,
  familyId: string
): Promise<NotificationPreference[]> {
  const existing = await prisma.notificationPreference.findMany({
    where: { userId, familyId },
  });

  const existingTypes = new Set(existing.map((p) => p.alertType));
  const missingTypes = ALERT_TYPES.filter((t) => !existingTypes.has(t));

  if (missingTypes.length === 0) {
    return existing;
  }

  logger.info('惰性创建默认通知偏好', {
    userId,
    familyId,
    count: missingTypes.length,
  });

  const created = await Promise.all(
    missingTypes.map((alertType) =>
      prisma.notificationPreference.create({
        data: { userId, familyId, alertType },
      })
    )
  );

  return [...existing, ...created];
}

/**
 * 批量更新用户在某家庭的偏好（按 alertType 匹配 upsert，不存在则创建）。
 * 校验 alertType / minSeverity 合法性，非法值抛错。
 */
export async function updatePreferences(
  userId: string,
  familyId: string,
  preferences: PreferenceInput[]
): Promise<NotificationPreference[]> {
  for (const preference of preferences) {
    if (!isValidAlertType(preference.alertType)) {
      throw new Error(`非法的告警类型: ${preference.alertType}`);
    }
    if (!isValidSeverity(preference.minSeverity)) {
      throw new Error(`非法的严重度: ${preference.minSeverity}`);
    }
  }

  return Promise.all(
    preferences.map((preference) =>
      prisma.notificationPreference.upsert({
        where: {
          userId_familyId_alertType: {
            userId,
            familyId,
            alertType: preference.alertType,
          },
        },
        create: {
          userId,
          familyId,
          alertType: preference.alertType,
          minSeverity: preference.minSeverity,
          inAppEnabled: preference.inAppEnabled,
          emailEnabled: preference.emailEnabled,
          pushEnabled: preference.pushEnabled,
        },
        update: {
          minSeverity: preference.minSeverity,
          inAppEnabled: preference.inAppEnabled,
          emailEnabled: preference.emailEnabled,
          pushEnabled: preference.pushEnabled,
        },
      })
    )
  );
}

/**
 * 判断某告警是否应投递给某用户某渠道（供通知分发层使用）：
 * - 无偏好记录时按默认值处理（仅站内开启）
 * - 告警严重度低于用户 minSeverity 阈值时所有渠道均不投递
 * - 否则返回各渠道开关状态
 */
export async function shouldNotify(
  userId: string,
  familyId: string,
  alertType: string,
  severity: string
): Promise<{ inApp: boolean; email: boolean; push: boolean }> {
  const preference = await prisma.notificationPreference.findUnique({
    where: {
      userId_familyId_alertType: {
        userId,
        familyId,
        alertType,
      },
    },
  });

  // 无偏好记录：使用默认值（站内开、邮件/推送关）
  if (!preference) {
    return { inApp: true, email: false, push: false };
  }

  // 严重度低于阈值：所有渠道静默
  if (!meetsSeverity(severity, preference.minSeverity)) {
    return { inApp: false, email: false, push: false };
  }

  return {
    inApp: preference.inAppEnabled,
    email: preference.emailEnabled,
    push: preference.pushEnabled,
  };
}

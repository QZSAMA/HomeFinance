import api from './api';

// 通知渠道
export type NotificationChannel = 'IN_APP' | 'EMAIL' | 'WEB_PUSH';

// 投递状态：已送达 / 失败 / 跳过（渠道未启用或未配置）
export type DeliveryStatus = 'SENT' | 'FAILED' | 'SKIPPED';

// 严重度（与告警 severity 一致）
export type NotificationSeverity = 'HIGH' | 'MEDIUM' | 'LOW';

// 告警快照：投递时固化的告警内容
export interface AlertSnapshot {
  title: string;
  description: string;
  amount?: number | string | null;
  severity: NotificationSeverity;
  type: string;
  category?: string | null;
  alertId: string;
  familyId: string;
  createdAt: string;
}

// 通知投递记录（alert.isRead 为家庭级已读状态）
export interface NotificationDelivery {
  id: string;
  alertId: string;
  userId: string;
  familyId: string;
  channel: NotificationChannel;
  status: DeliveryStatus;
  errorMessage?: string | null;
  alertSnapshot: AlertSnapshot;
  sentAt: string | null;
  createdAt: string;
  alert?: { isRead: boolean } | null;
}

// GET /notifications 响应：投递列表 + 未读数
export interface NotificationsResponse {
  notifications: NotificationDelivery[];
  unreadCount: number;
}

// 通知偏好（getPreferences 返回项，含 id）
export interface NotificationPreference {
  id: string;
  alertType: string;
  minSeverity: NotificationSeverity;
  inAppEnabled: boolean;
  emailEnabled: boolean;
  pushEnabled: boolean;
}

// 偏好更新输入（按 alertType 匹配，无需 id）
export interface PreferenceInput {
  alertType: string;
  minSeverity: NotificationSeverity;
  inAppEnabled: boolean;
  emailEnabled: boolean;
  pushEnabled: boolean;
}

// 通知列表查询参数
export interface NotificationQueryParams {
  status?: DeliveryStatus;
  channel?: NotificationChannel;
  limit?: number;
}

// 获取当前用户在某家庭的通知投递列表（含未读数）
export const getNotifications = (familyId: string, params?: NotificationQueryParams) =>
  api
    .get<NotificationsResponse>(`/families/${familyId}/notifications`, { params })
    .then((r) => r.data);

// 获取未读数（供铃铛轮询）
export const getUnreadCount = (familyId: string) =>
  api
    .get<{ unreadCount: number }>(`/families/${familyId}/notifications/unread-count`)
    .then((r) => r.data.unreadCount);

// 标记单条通知对应告警已读（家庭级）
export const markNotificationRead = (familyId: string, deliveryId: string) =>
  api
    .put<{ success: boolean }>(`/families/${familyId}/notifications/${deliveryId}/read`)
    .then((r) => r.data);

// 获取当前用户在某家庭的全部通知偏好（后端惰性创建 7 类默认记录）
export const getPreferences = (familyId: string) =>
  api
    .get<{ preferences: NotificationPreference[] }>(
      `/families/${familyId}/notification-preferences`
    )
    .then((r) => r.data.preferences);

// 批量更新通知偏好
export const updatePreferences = (familyId: string, preferences: PreferenceInput[]) =>
  api
    .put<{ preferences: NotificationPreference[] }>(
      `/families/${familyId}/notification-preferences`,
      { preferences }
    )
    .then((r) => r.data.preferences);

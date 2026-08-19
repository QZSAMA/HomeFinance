import api from './api';

// 异常告警：type 含检测规则四类 + 预算联动两类
export interface AnomalyAlert {
  id: string;
  type: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  description: string;
  amount?: number | string | null;
  category?: string | null;
  isRead: boolean;
  createdAt: string;
}

// GET /anomalies 响应：列表 + 全量未读数（不受 isRead 筛选影响）
export interface AlertsResponse {
  alerts: AnomalyAlert[];
  unreadCount: number;
}

export interface DetectResult {
  detected: number;
  saved: number;
}

export const getAlerts = (familyId: string, isRead?: boolean) =>
  api
    .get<AlertsResponse>(`/families/${familyId}/anomalies`, {
      params: isRead === undefined ? {} : { isRead },
    })
    .then((r) => r.data);

export const detectAnomalies = (familyId: string) =>
  api.get<DetectResult>(`/families/${familyId}/anomalies/detect`).then((r) => r.data);

export const markRead = (familyId: string, alertId: string) =>
  api.put<AnomalyAlert>(`/families/${familyId}/anomalies/${alertId}/read`).then((r) => r.data);

export const markAllRead = (familyId: string) =>
  api.put<{ updated: number }>(`/families/${familyId}/anomalies/read-all`).then((r) => r.data);

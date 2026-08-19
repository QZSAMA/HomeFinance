import api from './api';

// V3.3.4：净值历史服务，封装净值快照查询与手动触发

export interface NetWorthSnapshot {
  familyId: string;
  date: string;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  assetBreakdown: Record<string, number>;
}

// GET /api/families/:id/net-worth/history?startDate=&endDate= - 获取净值历史快照
export const getHistory = async (
  familyId: string,
  startDate?: string,
  endDate?: string
): Promise<NetWorthSnapshot[]> => {
  const params: Record<string, string> = {};
  if (startDate) params.startDate = startDate;
  if (endDate) params.endDate = endDate;
  const response = await api.get<NetWorthSnapshot[]>(`/families/${familyId}/net-worth/history`, {
    params,
  });
  return response.data;
};

// GET /api/families/:id/net-worth/latest - 获取最近一条净值快照（无历史时后端返回 404）
export const getLatest = async (familyId: string): Promise<NetWorthSnapshot | null> => {
  try {
    const response = await api.get<NetWorthSnapshot>(`/families/${familyId}/net-worth/latest`);
    return response.data;
  } catch (err: any) {
    if (err.response?.status === 404) return null;
    throw err;
  }
};

// POST /api/families/:id/net-worth/snapshot - 手动触发当前家庭净值快照生成
export const takeSnapshot = async (familyId: string): Promise<NetWorthSnapshot> => {
  const response = await api.post<NetWorthSnapshot>(`/families/${familyId}/net-worth/snapshot`);
  return response.data;
};

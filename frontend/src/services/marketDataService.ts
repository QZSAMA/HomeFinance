import api from './api';

// V3.3.4：行情数据服务，封装证券行情查询与资产价格刷新

export interface MarketQuote {
  symbol: string;
  name: string;
  price: number;
  change?: number;
  changePercent?: number;
}

export interface RefreshAssetDetail {
  assetId: string;
  name: string;
  success: boolean;
  price?: number;
  error?: string;
}

export interface RefreshAllPricesResult {
  updated: number;
  failed: number;
  details: RefreshAssetDetail[];
}

export interface RefreshSingleAssetResult {
  success: boolean;
  price?: number;
  error?: string;
}

// GET /api/families/:id/market-data/quote?symbol= - 获取单只证券最新行情
export const getQuote = async (familyId: string, symbol: string): Promise<MarketQuote> => {
  const response = await api.get<MarketQuote>(`/families/${familyId}/market-data/quote`, {
    params: { symbol },
  });
  return response.data;
};

// POST /api/families/:id/market-data/refresh - 刷新家庭所有资产行情
export const refreshAllPrices = async (familyId: string): Promise<RefreshAllPricesResult> => {
  const response = await api.post<RefreshAllPricesResult>(`/families/${familyId}/market-data/refresh`);
  return response.data;
};

// POST /api/families/:id/market-data/refresh/:assetId - 刷新单个资产行情
export const refreshAssetPrice = async (
  familyId: string,
  assetId: string
): Promise<RefreshSingleAssetResult> => {
  const response = await api.post<RefreshSingleAssetResult>(
    `/families/${familyId}/market-data/refresh/${assetId}`
  );
  return response.data;
};

import api from './api';

export interface Income {
  id: string;
  familyId: string;
  createdBy: string;
  category: string;
  amount: number;
  description?: string;
  source?: string;
  date: string;
  // V3.3.4：投资收益类型与关联资产（用于投资收益页面）
  incomeType?: string;
  assetId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Expense {
  id: string;
  familyId: string;
  createdBy: string;
  category: string;
  amount: number;
  description?: string;
  paymentMethod?: string;
  date: string;
  createdAt: string;
  updatedAt: string;
}

export interface Asset {
  id: string;
  familyId: string;
  name: string;
  type: string;
  category?: string;
  value: number;
  costBasis?: number;
  currency: string;
  purchaseDate?: string;
  description?: string;
  // V3.3.4：证券代码、持有数量、单位、最新市价与涨跌幅（用于市值追踪）
  symbol?: string;
  quantity?: number;
  unit?: string;
  marketPrice?: number;
  marketPriceDate?: string;
  changePercent?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Liability {
  id: string;
  familyId: string;
  name: string;
  type: string;
  amount: number;
  interestRate?: number;
  startDate?: string;
  endDate?: string;
  currency: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DuplicateCheckResult {
  hasDuplicate: boolean;
  duplicates: Income[] | Expense[];
}

export const getIncomes = async (familyId: string, incomeType?: string): Promise<Income[]> => {
  const params: Record<string, string> = {};
  if (incomeType) params.incomeType = incomeType;
  const response = await api.get<Income[]>(`/families/${familyId}/incomes`, { params });
  return response.data;
};

export const createIncome = async (familyId: string, data: Omit<Income, 'id' | 'familyId' | 'createdBy' | 'createdAt' | 'updatedAt'>): Promise<Income> => {
  const response = await api.post<Income>(`/families/${familyId}/incomes`, data);
  return response.data;
};

export const updateIncome = async (familyId: string, id: string, data: Omit<Income, 'id' | 'familyId' | 'createdBy' | 'createdAt' | 'updatedAt'>): Promise<Income> => {
  const response = await api.put<Income>(`/families/${familyId}/incomes/${id}`, data);
  return response.data;
};

export const deleteIncome = async (familyId: string, id: string): Promise<void> => {
  await api.delete(`/families/${familyId}/incomes/${id}`);
};

export const checkIncomeDuplicate = async (familyId: string, data: { amount: number; date: string; description?: string }): Promise<DuplicateCheckResult> => {
  const response = await api.post<DuplicateCheckResult>(`/families/${familyId}/incomes/check-duplicate`, data);
  return response.data;
};

export const getExpenses = async (familyId: string): Promise<Expense[]> => {
  const response = await api.get<Expense[]>(`/families/${familyId}/expenses`);
  return response.data;
};

export const createExpense = async (familyId: string, data: Omit<Expense, 'id' | 'familyId' | 'createdBy' | 'createdAt' | 'updatedAt'>): Promise<Expense> => {
  const response = await api.post<Expense>(`/families/${familyId}/expenses`, data);
  return response.data;
};

export const updateExpense = async (familyId: string, id: string, data: Omit<Expense, 'id' | 'familyId' | 'createdBy' | 'createdAt' | 'updatedAt'>): Promise<Expense> => {
  const response = await api.put<Expense>(`/families/${familyId}/expenses/${id}`, data);
  return response.data;
};

export const deleteExpense = async (familyId: string, id: string): Promise<void> => {
  await api.delete(`/families/${familyId}/expenses/${id}`);
};

export const checkExpenseDuplicate = async (familyId: string, data: { amount: number; date: string; description?: string }): Promise<DuplicateCheckResult> => {
  const response = await api.post<DuplicateCheckResult>(`/families/${familyId}/expenses/check-duplicate`, data);
  return response.data;
};

export const getAssets = async (familyId: string): Promise<Asset[]> => {
  const response = await api.get<Asset[]>(`/families/${familyId}/assets`);
  return response.data;
};

export const createAsset = async (familyId: string, data: Omit<Asset, 'id' | 'familyId' | 'createdAt' | 'updatedAt'>): Promise<Asset> => {
  const response = await api.post<Asset>(`/families/${familyId}/assets`, data);
  return response.data;
};

export const updateAsset = async (familyId: string, id: string, data: Omit<Asset, 'id' | 'familyId' | 'createdAt' | 'updatedAt'>): Promise<Asset> => {
  const response = await api.put<Asset>(`/families/${familyId}/assets/${id}`, data);
  return response.data;
};

export const deleteAsset = async (familyId: string, id: string): Promise<void> => {
  await api.delete(`/families/${familyId}/assets/${id}`);
};

export const getLiabilities = async (familyId: string): Promise<Liability[]> => {
  const response = await api.get<Liability[]>(`/families/${familyId}/liabilities`);
  return response.data;
};

export const createLiability = async (familyId: string, data: Omit<Liability, 'id' | 'familyId' | 'createdAt' | 'updatedAt'>): Promise<Liability> => {
  const response = await api.post<Liability>(`/families/${familyId}/liabilities`, data);
  return response.data;
};

export const updateLiability = async (familyId: string, id: string, data: Omit<Liability, 'id' | 'familyId' | 'createdAt' | 'updatedAt'>): Promise<Liability> => {
  const response = await api.put<Liability>(`/families/${familyId}/liabilities/${id}`, data);
  return response.data;
};

export const deleteLiability = async (familyId: string, id: string): Promise<void> => {
  await api.delete(`/families/${familyId}/liabilities/${id}`);
};

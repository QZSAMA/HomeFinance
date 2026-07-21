import api from './api';

export interface FamilyCompareItem {
  familyId: string;
  familyName: string;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  thisMonthIncome: number;
  thisMonthExpense: number;
}

export const getCompareSummary = () =>
  api.get<FamilyCompareItem[]>('/compare/summary').then((r) => r.data);

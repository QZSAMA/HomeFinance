import api from './api';
import type { ConversionStatus, PeriodWindow } from './reportService';

export interface FamilyCompareItem {
  familyId: string;
  familyName: string;
  totalAssets: number | null;
  totalLiabilities: number | null;
  netWorth: number | null;
  thisMonthIncome: number | null;
  thisMonthExpense: number | null;
  totalAssetsByCurrency?: Record<string, number>;
  totalLiabilitiesByCurrency?: Record<string, number>;
  thisMonthIncomeByCurrency?: Record<string, number>;
  thisMonthExpenseByCurrency?: Record<string, number>;
  conversionStatus: ConversionStatus;
  window: PeriodWindow;
  timezone: string;
  baseCurrency: string;
}

export const getCompareSummary = (month: string) =>
  api.get<FamilyCompareItem[]>('/compare/summary', { params: { month } }).then((r) => r.data);

import api from './api';

export type ConversionStatus = 'exact' | 'unavailable' | 'partial';
export type ReconciliationStatus = 'passed' | 'unavailable' | 'failed';
export interface PeriodWindow {
  timezone: string;
  startUtc: string;
  endUtc: string;
  startLocal: string;
  endLocalExclusive: string;
}
export interface MoneySummary {
  totalsByCurrency: Record<string, number>;
  totalInBaseCurrency: number | null;
  baseCurrency: string;
  conversionStatus: ConversionStatus;
}

export interface InvestmentAllocationItem {
  category: string;
  value: number | null;
  percentage: number | null;
}

export interface InvestmentAllocationResponse {
  totalValue: number | null;
  allocation: InvestmentAllocationItem[];
}

export interface BalanceSheetResponse {
  totalAssets: number | null;
  totalLiabilities: number | null;
  netWorth: number | null;
  assets: Record<string, number | null>;
  liabilities: Record<string, number | null>;
  assetList: any[];
  liabilityList: any[];
  timezone?: string;
  baseCurrency?: string;
  window?: PeriodWindow;
  totalsByCurrency?: Record<string, number>;
  liabilityTotalsByCurrency?: Record<string, number>;
  conversionStatus?: ConversionStatus;
  reconciliationStatus?: ReconciliationStatus;
  assetsByCurrency?: Record<string, Record<string, number>>;
  liabilitiesByCurrency?: Record<string, Record<string, number>>;
}

export interface IncomeStatementResponse {
  totalIncome: number | null;
  totalExpense: number | null;
  netIncome: number | null;
  incomeByCategory: Record<string, number | null>;
  expenseByCategory: Record<string, number | null>;
  incomes: any[];
  expenses: any[];
  startDate: string | null;
  endDate: string | null;
  timezone?: string;
  baseCurrency?: string;
  window?: PeriodWindow;
  totalsByCurrency?: Record<string, number>;
  expenseTotalsByCurrency?: Record<string, number>;
  conversionStatus?: ConversionStatus;
  reconciliationStatus?: ReconciliationStatus;
  netIncomeByCurrency?: Record<string, number>;
}

export interface CashFlowResponse {
  operating: { income: number | null; expense: number | null; net: number | null };
  investing: { income: number | null; expense: number | null; net: number | null };
  financing: { income: number | null; expense: number | null; net: number | null };
  other: { income: number | null; expense: number | null; net: number | null };
  netCashFlow: number | null;
  startDate: string | null;
  endDate: string | null;
  timezone?: string;
  baseCurrency?: string;
  window?: PeriodWindow;
  totalsByCurrency?: Record<string, number>;
  expenseTotalsByCurrency?: Record<string, number>;
  conversionStatus?: ConversionStatus;
  reconciliationStatus?: ReconciliationStatus;
}

export interface SummaryResponse {
  balanceSheet: {
    totalAssets: number | null;
    totalLiabilities: number | null;
    netWorth: number | null;
  };
  incomeStatement: {
    thisMonthIncome: number | null;
    lastMonthIncome: number | null;
    thisMonthExpense: number | null;
    lastMonthExpense: number | null;
    incomeChange: number | null;
    expenseChange: number | null;
    netIncome: number | null;
  };
  investmentAllocation: InvestmentAllocationItem[];
  recentTransactions: {
    incomes: any[];
    expenses: any[];
  };
  timezone?: string;
  baseCurrency?: string;
  window?: PeriodWindow;
  conversionStatus?: ConversionStatus;
  reconciliationStatus?: ReconciliationStatus;
  totalsByCurrency?: Record<string, number>;
  liabilityTotalsByCurrency?: Record<string, number>;
}

export const getBalanceSheet = async (familyId: string): Promise<BalanceSheetResponse> => {
  const response = await api.get<BalanceSheetResponse>(`/families/${familyId}/reports/balance-sheet`);
  return response.data;
};

export const getIncomeStatement = async (familyId: string, startDate?: string, endDate?: string): Promise<IncomeStatementResponse> => {
  const params: Record<string, string> = {};
  if (startDate) params.startDate = startDate;
  if (endDate) params.endDate = endDate;
  const response = await api.get<IncomeStatementResponse>(`/families/${familyId}/reports/income-statement`, { params });
  return response.data;
};

export const getCashFlow = async (familyId: string, startDate?: string, endDate?: string): Promise<CashFlowResponse> => {
  const params: Record<string, string> = {};
  if (startDate) params.startDate = startDate;
  if (endDate) params.endDate = endDate;
  const response = await api.get<CashFlowResponse>(`/families/${familyId}/reports/cash-flow`, { params });
  return response.data;
};

export const getSummary = async (familyId: string): Promise<SummaryResponse> => {
  const response = await api.get<SummaryResponse>(`/families/${familyId}/reports/summary`);
  return response.data;
};

export const getInvestmentAllocation = async (familyId: string): Promise<InvestmentAllocationResponse> => {
  const response = await api.get<InvestmentAllocationResponse>(`/families/${familyId}/assets/allocation`);
  return response.data;
};

import api from './api';

export interface InvestmentAllocationItem {
  category: string;
  value: number;
  percentage: number;
}

export interface InvestmentAllocationResponse {
  totalValue: number;
  allocation: InvestmentAllocationItem[];
}

export interface BalanceSheetResponse {
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  assets: Record<string, number>;
  liabilities: Record<string, number>;
  assetList: any[];
  liabilityList: any[];
}

export interface IncomeStatementResponse {
  totalIncome: number;
  totalExpense: number;
  netIncome: number;
  incomeByCategory: Record<string, number>;
  expenseByCategory: Record<string, number>;
  incomes: any[];
  expenses: any[];
  startDate: string | null;
  endDate: string | null;
}

export interface CashFlowResponse {
  operating: { income: number; expense: number; net: number };
  investing: { income: number; expense: number; net: number };
  financing: { income: number; expense: number; net: number };
  other: { income: number; expense: number };
  netCashFlow: number;
  startDate: string | null;
  endDate: string | null;
}

export interface SummaryResponse {
  balanceSheet: {
    totalAssets: number;
    totalLiabilities: number;
    netWorth: number;
  };
  incomeStatement: {
    thisMonthIncome: number;
    lastMonthIncome: number;
    thisMonthExpense: number;
    lastMonthExpense: number;
    incomeChange: number;
    expenseChange: number;
    netIncome: number;
  };
  investmentAllocation: InvestmentAllocationItem[];
  recentTransactions: {
    incomes: any[];
    expenses: any[];
  };
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

// V3.3.4：投资收益报表汇总（分红/利息/租金/投资收益），按类型与关联资产分组
export interface InvestmentIncomeByAsset {
  assetId: string;
  name: string | null;
  total: number;
}

export interface InvestmentIncomeReport {
  total: number;
  byType: Record<string, number>;
  byAsset: InvestmentIncomeByAsset[];
}

export const getInvestmentIncomeReport = async (
  familyId: string,
  startDate?: string,
  endDate?: string
): Promise<InvestmentIncomeReport> => {
  const params: Record<string, string> = {};
  if (startDate) params.startDate = startDate;
  if (endDate) params.endDate = endDate;
  const response = await api.get<InvestmentIncomeReport>(
    `/families/${familyId}/reports/investment-income`,
    { params }
  );
  return response.data;
};

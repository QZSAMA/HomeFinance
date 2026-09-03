import api from './api';
import type { ConversionStatus, PeriodWindow } from './reportService';

export interface Budget {
  id: string;
  familyId: string;
  category: string;
  amount: number;
  currency?: string;
  period: string;
  startDate: string;
  endDate: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetProgress {
  budget: Budget;
  spent: number | null;
  remaining: number | null;
  percentage: number | null;
  totalsByCurrency?: Record<string, number>;
  conversionStatus?: ConversionStatus;
  window?: PeriodWindow;
  timezone?: string;
  baseCurrency?: string;
}

export type BudgetInput = Omit<Budget, 'id' | 'familyId' | 'createdBy' | 'createdAt' | 'updatedAt' | 'endDate' | 'currency'> & {
  currency?: string;
  endDate?: string;
};

export const getBudgets = (familyId: string): Promise<Budget[]> =>
  api.get<Budget[]>(`/families/${familyId}/budgets`).then((r) => r.data);

export const createBudget = (familyId: string, data: BudgetInput): Promise<Budget> =>
  api.post<Budget>(`/families/${familyId}/budgets`, data).then((r) => r.data);

export const updateBudget = (familyId: string, id: string, data: BudgetInput): Promise<Budget> =>
  api.put<Budget>(`/families/${familyId}/budgets/${id}`, data).then((r) => r.data);

export const deleteBudget = (familyId: string, id: string): Promise<void> =>
  api.delete(`/families/${familyId}/budgets/${id}`).then((r) => r.data);

export const getBudgetProgress = (familyId: string): Promise<BudgetProgress[]> =>
  api.get<BudgetProgress[]>(`/families/${familyId}/budgets/progress`).then((r) => r.data);

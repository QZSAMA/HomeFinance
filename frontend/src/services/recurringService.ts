import api from './api';

export interface RecurringTransaction {
  id: string;
  familyId: string;
  type: 'INCOME' | 'EXPENSE';
  category: string;
  amount: number;
  description?: string | null;
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  nextDate: string;
  endDate?: string | null;
  isActive: boolean;
  lastExecutedAt?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type RecurringInput = Omit<
  RecurringTransaction,
  'id' | 'familyId' | 'createdBy' | 'createdAt' | 'updatedAt' | 'isActive' | 'lastExecutedAt' | 'description'
> & {
  description?: string;
  endDate?: string;
};

export const getRecurring = (familyId: string) =>
  api.get<RecurringTransaction[]>(`/families/${familyId}/recurring`).then((r) => r.data);

export const getDueRecurring = (familyId: string) =>
  api.get<RecurringTransaction[]>(`/families/${familyId}/recurring/due`).then((r) => r.data);

export const createRecurring = (familyId: string, data: RecurringInput) =>
  api.post<RecurringTransaction>(`/families/${familyId}/recurring`, data).then((r) => r.data);

export const updateRecurring = (familyId: string, id: string, data: Partial<RecurringInput>) =>
  api.put<RecurringTransaction>(`/families/${familyId}/recurring/${id}`, data).then((r) => r.data);

export const deleteRecurring = (familyId: string, id: string) =>
  api.delete(`/families/${familyId}/recurring/${id}`).then((r) => r.data);

export const executeRecurring = (familyId: string, id: string) =>
  api.post<{ message: string; nextDate: string; isActive: boolean }>(
    `/families/${familyId}/recurring/${id}/execute`
  ).then((r) => r.data);

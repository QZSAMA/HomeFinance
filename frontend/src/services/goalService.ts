import api from './api';
import type { ConversionStatus } from './reportService';

export type GoalType = 'SAVING' | 'DEBT_PAYOFF' | 'INVESTMENT';

export interface Goal {
  id: string;
  familyId: string;
  title: string;
  type: GoalType;
  targetAmount: number;
  currency?: string;
  deadline: string | null;
  isCompleted: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface GoalProgress {
  goal: Goal;
  currentAmount: number | null;
  percentage: number | null;
  totalsByCurrency?: Record<string, number>;
  conversionStatus?: ConversionStatus;
  progressStatus?: 'exact' | 'unavailable';
}

export interface GoalInput {
  title: string;
  type: GoalType;
  targetAmount: number;
  currency?: string;
  deadline?: string;
}

export const getGoals = (familyId: string) =>
  api.get<Goal[]>(`/families/${familyId}/goals`).then((r) => r.data);

export const getGoalProgress = (familyId: string) =>
  api.get<GoalProgress[]>(`/families/${familyId}/goals/progress`).then((r) => r.data);

export const createGoal = (familyId: string, data: GoalInput) =>
  api.post<Goal>(`/families/${familyId}/goals`, data).then((r) => r.data);

export const updateGoal = (familyId: string, id: string, data: Partial<GoalInput>) =>
  api.put<Goal>(`/families/${familyId}/goals/${id}`, data).then((r) => r.data);

export const deleteGoal = (familyId: string, id: string) =>
  api.delete(`/families/${familyId}/goals/${id}`).then((r) => r.data);

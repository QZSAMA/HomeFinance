import api from './api';

const downloadBlob = (data: Blob, filename: string) => {
  const url = window.URL.createObjectURL(data);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};

export const exportIncomes = async (
  familyId: string,
  startDate?: string,
  endDate?: string
): Promise<void> => {
  const params: Record<string, string> = {};
  if (startDate) params.startDate = startDate;
  if (endDate) params.endDate = endDate;
  const res = await api.get(`/families/${familyId}/export/incomes`, {
    params,
    responseType: 'blob',
  });
  downloadBlob(res.data, 'incomes.xlsx');
};

export const exportExpenses = async (
  familyId: string,
  startDate?: string,
  endDate?: string
): Promise<void> => {
  const params: Record<string, string> = {};
  if (startDate) params.startDate = startDate;
  if (endDate) params.endDate = endDate;
  const res = await api.get(`/families/${familyId}/export/expenses`, {
    params,
    responseType: 'blob',
  });
  downloadBlob(res.data, 'expenses.xlsx');
};

export const exportBalanceSheet = async (familyId: string): Promise<void> => {
  const res = await api.get(`/families/${familyId}/export/balance-sheet`, {
    responseType: 'blob',
  });
  downloadBlob(res.data, 'balance-sheet.xlsx');
};

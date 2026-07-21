import api from './api';

export interface ImportedTransaction {
  date: string;
  description: string;
  amount: number;
  type: 'INCOME' | 'EXPENSE';
  category?: string;
}

export const previewCSV = (familyId: string, file: File, format: 'alipay' | 'wechat') => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('format', format);
  return api
    .post<ImportedTransaction[]>(`/families/${familyId}/import/csv`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    .then((r) => r.data);
};

export const confirmImport = (familyId: string, items: ImportedTransaction[]) =>
  api
    .post<{ successCount: number }>(`/families/${familyId}/import/confirm`, { items })
    .then((r) => r.data.successCount);

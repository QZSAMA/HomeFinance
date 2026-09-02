import api from './api';

export interface ImportedTransaction {
  date: string;
  description: string;
  amount: number;
  type: 'INCOME' | 'EXPENSE';
  category?: string;
}

export interface ImportPreview {
  items: ImportedTransaction[];
  batchId: string;
  previewHash: string;
}

export const previewCSV = (familyId: string, file: File, format: 'alipay' | 'wechat') => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('format', format);
  return api
    .post<ImportedTransaction[]>(`/families/${familyId}/import/csv`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    .then((r): ImportPreview => {
      const batchId = r.headers['x-import-batch-id'];
      const previewHash = r.headers['x-import-preview-hash'];
      if (
        typeof batchId !== 'string'
        || !batchId
        || typeof previewHash !== 'string'
        || !/^[0-9a-f]{64}$/.test(previewHash)
      ) {
        throw new Error('服务器未返回有效的导入预览批次');
      }
      return { items: r.data, batchId, previewHash };
    });
};

export const confirmImport = (
  familyId: string,
  batchId: string,
  expectedPreviewHash: string,
  categoryPatch: Record<string, string>,
  idempotencyKey: string,
) =>
  api
    .post<{ successCount: number }>(
      `/families/${familyId}/import/confirm`,
      { batchId, expectedPreviewHash, categoryPatch },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    )
    .then((r) => r.data.successCount);

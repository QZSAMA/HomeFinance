import api from './api';

// 数据源类型：与 ImportPage 五种账单格式对齐
export type ImportSourceType = 'alipay' | 'wechat' | 'cmb' | 'icbc' | 'boc';

export interface ImportSource {
  id: string;
  familyId: string;
  name: string;
  type: ImportSourceType;
  watchPath: string;
  syncStatus: 'IDLE' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'DISABLED';
  lastSyncedAt?: string | null;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImportSourceInput {
  name: string;
  type: ImportSourceType;
  watchPath: string;
}

export interface ImportSourceUpdate {
  name?: string;
  type?: ImportSourceType;
  watchPath?: string;
}

export interface SyncResult {
  status: ImportSource['syncStatus'];
  message: string;
  importedCount?: number;
  lastSyncedAt?: string;
}

export const getImportSources = (familyId: string) =>
  api.get<ImportSource[]>(`/families/${familyId}/import-sources`).then((r) => r.data);

export const createImportSource = (familyId: string, data: ImportSourceInput) =>
  api.post<ImportSource>(`/families/${familyId}/import-sources`, data).then((r) => r.data);

export const updateImportSource = (familyId: string, id: string, data: ImportSourceUpdate) =>
  api.put<ImportSource>(`/families/${familyId}/import-sources/${id}`, data).then((r) => r.data);

export const deleteImportSource = (familyId: string, id: string) =>
  api.delete(`/families/${familyId}/import-sources/${id}`).then((r) => r.data);

export const syncImportSource = (familyId: string, id: string) =>
  api.post<SyncResult>(`/families/${familyId}/import-sources/${id}/sync`).then((r) => r.data);

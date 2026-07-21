import api from './api';

export interface FileRecord {
  id: string;
  familyId: string;
  userId: string;
  name: string;
  path: string;
  type: string;
  size: number;
  mimeType: string;
  phash: string | null;
  url: string;
  uploadedAt: string;
}

export interface UploadResult {
  files: FileRecord[];
  duplicates: Array<{ filename: string; duplicateOf: string }>;
  message: string;
}

export interface DuplicateResult {
  duplicates: Array<{ file1: string; file2: string; similarity: number }>;
}

export const getFiles = async (familyId: string): Promise<FileRecord[]> => {
  const response = await api.get<FileRecord[]>(`/families/${familyId}/files`);
  return response.data;
};

export const uploadFiles = async (familyId: string, files: File[]): Promise<UploadResult> => {
  const formData = new FormData();
  files.forEach((file) => formData.append('files', file));
  const response = await api.post<UploadResult>(`/families/${familyId}/files/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};

export const deleteFile = async (familyId: string, id: string): Promise<void> => {
  await api.delete(`/families/${familyId}/files/${id}`);
};

export const checkDuplicates = async (familyId: string): Promise<DuplicateResult> => {
  const response = await api.get<DuplicateResult>(`/families/${familyId}/files/check-duplicates`);
  return response.data;
};

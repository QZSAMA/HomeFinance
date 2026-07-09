import api from './api';
import type { Family } from '../types';

export const getFamilies = async (): Promise<Family[]> => {
  const response = await api.get<Family[]>('/families');
  return response.data;
};

export const getFamily = async (id: string): Promise<Family> => {
  const response = await api.get<Family>(`/families/${id}`);
  return response.data;
};

export const createFamily = async (name: string, description?: string): Promise<Family> => {
  const response = await api.post<Family>('/families', { name, description });
  return response.data;
};

export const updateFamily = async (id: string, name: string, description?: string): Promise<Family> => {
  const response = await api.put<Family>(`/families/${id}`, { name, description });
  return response.data;
};

export const deleteFamily = async (id: string): Promise<void> => {
  await api.delete(`/families/${id}`);
};

export const inviteMember = async (familyId: string, email: string, role: 'admin' | 'member' | 'viewer' = 'member'): Promise<Family> => {
  const response = await api.post<Family>(`/families/${familyId}/invite`, { email, role });
  return response.data;
};

export const updateMemberRole = async (familyId: string, memberId: string, role: 'admin' | 'member' | 'viewer'): Promise<Family> => {
  const response = await api.put<Family>(`/families/${familyId}/members/${memberId}/role`, { role });
  return response.data;
};

export const removeMember = async (familyId: string, memberId: string): Promise<void> => {
  await api.delete(`/families/${familyId}/members/${memberId}`);
};

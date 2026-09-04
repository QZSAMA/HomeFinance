import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as authService from '../services/authService';
import { useFamilyStore } from './useFamilyStore';
import { useAuthStore } from './useAuthStore';

const storage = vi.hoisted(() => {
  const values = new Map<string, string>();
  const testStorage = {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => { values.delete(key); },
    setItem: (key: string, value: string) => { values.set(key, value); },
  } as Storage;
  vi.stubGlobal('localStorage', testStorage);
  return testStorage;
});

vi.mock('../services/authService', () => ({
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn().mockResolvedValue(undefined),
}));

describe('useAuthStore logout', () => {
  beforeEach(() => {
    storage.clear();
    useFamilyStore.setState({ currentFamily: null, families: [] });
    useAuthStore.setState({ user: null, token: 'token', isAuthenticated: true, isLoading: false });
  });

  it('removes the selected family preference', async () => {
    useFamilyStore.getState().setCurrentFamily({ id: 'family-1', name: '测试家庭' } as any);
    await useAuthStore.getState().logout();
    expect(storage.getItem('homefinance.currentFamilyId')).toBeNull();
    expect(useFamilyStore.getState().currentFamily).toBeNull();
    expect(authService.logout).toHaveBeenCalledTimes(1);
  });
});

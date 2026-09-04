import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Family } from '../types';
import {
  clearPersistedCurrentFamily,
  getPersistedCurrentFamilyId,
  useFamilyStore,
} from './useFamilyStore';

const family = { id: 'family-1', name: '测试家庭' } as Family;

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  } as Storage;
}

describe('useFamilyStore family preference', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage());
    useFamilyStore.setState({ currentFamily: null, families: [] });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('persists only the selected family id and removes it when cleared', () => {
    useFamilyStore.getState().setCurrentFamily(family);
    expect(getPersistedCurrentFamilyId()).toBe(family.id);
    expect(localStorage.length).toBe(1);

    useFamilyStore.getState().setCurrentFamily(null);
    expect(getPersistedCurrentFamilyId()).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it('clears a persisted id through the shared cleanup boundary', () => {
    useFamilyStore.getState().setCurrentFamily(family);
    clearPersistedCurrentFamily();
    expect(getPersistedCurrentFamilyId()).toBeNull();
  });
});

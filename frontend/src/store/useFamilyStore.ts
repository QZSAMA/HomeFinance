import { create } from 'zustand';
import type { Family } from '../types';

const CURRENT_FAMILY_STORAGE_KEY = 'homefinance.currentFamilyId';

export const getPersistedCurrentFamilyId = (): string | null => {
  try {
    return localStorage.getItem(CURRENT_FAMILY_STORAGE_KEY);
  } catch {
    return null;
  }
};

const persistCurrentFamilyId = (id: string | null) => {
  try {
    if (id) {
      localStorage.setItem(CURRENT_FAMILY_STORAGE_KEY, id);
    } else {
      localStorage.removeItem(CURRENT_FAMILY_STORAGE_KEY);
    }
  } catch {
    // Storage can be disabled; the in-memory selection remains usable.
  }
};

export const clearPersistedCurrentFamily = () => persistCurrentFamilyId(null);

interface FamilyStore {
  currentFamily: Family | null;
  families: Family[];
  setCurrentFamily: (family: Family | null) => void;
  setFamilies: (families: Family[]) => void;
}

export const useFamilyStore = create<FamilyStore>((set) => ({
  currentFamily: null,
  families: [],
  setCurrentFamily: (family) => {
    persistCurrentFamilyId(family?.id ?? null);
    set({ currentFamily: family });
  },
  setFamilies: (families) => set({ families }),
}));

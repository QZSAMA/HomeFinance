import { create } from 'zustand';
import type { Family } from '../types';

interface FamilyStore {
  currentFamily: Family | null;
  families: Family[];
  setCurrentFamily: (family: Family | null) => void;
  setFamilies: (families: Family[]) => void;
}

export const useFamilyStore = create<FamilyStore>((set) => ({
  currentFamily: null,
  families: [],
  setCurrentFamily: (family) => set({ currentFamily: family }),
  setFamilies: (families) => set({ families }),
}));

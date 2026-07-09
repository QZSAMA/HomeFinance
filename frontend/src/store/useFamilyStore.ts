import { create } from 'zustand';
import type { Family } from '../types';

interface FamilyStore {
  currentFamily: Family | null;
  setCurrentFamily: (family: Family | null) => void;
}

export const useFamilyStore = create<FamilyStore>((set) => ({
  currentFamily: null,
  setCurrentFamily: (family) => set({ currentFamily: family }),
}));

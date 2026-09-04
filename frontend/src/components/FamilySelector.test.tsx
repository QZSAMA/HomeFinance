import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FamilySelector from './FamilySelector';
import * as familyService from '../services/familyService';
import { useFamilyStore } from '../store/useFamilyStore';

vi.mock('../services/familyService', () => ({
  getFamilies: vi.fn(),
}));

const family = {
  id: 'family-1',
  name: '第一个家庭',
  createdAt: '2026-09-02T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
  members: [],
  timezone: 'Asia/Shanghai',
};

const secondFamily = { ...family, id: 'family-2', name: '第二个家庭' };
const getFamiliesMock = vi.mocked(familyService.getFamilies);

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('FamilySelector loading', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage());
    useFamilyStore.setState({ currentFamily: null, families: [] });
    getFamiliesMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('loads families once and selects the first family when none is selected', async () => {
    getFamiliesMock.mockResolvedValue([family, secondFamily]);
    const { rerender } = render(<FamilySelector />);

    await waitFor(() => expect(getFamiliesMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useFamilyStore.getState().currentFamily?.id).toBe(family.id));

    rerender(<FamilySelector />);
    expect(getFamiliesMock).toHaveBeenCalledTimes(1);
  });

  it('does not overwrite a family selected while the request is pending', async () => {
    const pending = deferred<typeof family[]>();
    getFamiliesMock.mockReturnValue(pending.promise);
    render(<FamilySelector />);

    await waitFor(() => expect(getFamiliesMock).toHaveBeenCalledTimes(1));
    act(() => {
      useFamilyStore.getState().setCurrentFamily(secondFamily);
    });
    await act(async () => {
      pending.resolve([family, secondFamily]);
      await pending.promise;
    });

    expect(useFamilyStore.getState().currentFamily?.id).toBe(secondFamily.id);
  });

  it('restores the persisted family after a full store reset', async () => {
    getFamiliesMock.mockResolvedValue([family, secondFamily]);
    act(() => useFamilyStore.getState().setCurrentFamily(secondFamily));
    useFamilyStore.setState({ currentFamily: null, families: [] });

    render(<FamilySelector />);

    await waitFor(() => expect(useFamilyStore.getState().currentFamily?.id).toBe(secondFamily.id));
    expect(screen.getByRole('combobox')).toHaveValue(secondFamily.id);
  });

  it('falls back to the first authorized family when the persisted id is absent', async () => {
    getFamiliesMock.mockResolvedValue([family, secondFamily]);
    localStorage.setItem('homefinance.currentFamilyId', 'revoked-family');

    render(<FamilySelector />);

    await waitFor(() => expect(useFamilyStore.getState().currentFamily?.id).toBe(family.id));
    expect(localStorage.getItem('homefinance.currentFamilyId')).toBe(family.id);
  });
});

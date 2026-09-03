import { act, render, waitFor } from '@testing-library/react';
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('FamilySelector loading', () => {
  beforeEach(() => {
    useFamilyStore.setState({ currentFamily: null, families: [] });
    getFamiliesMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
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
});

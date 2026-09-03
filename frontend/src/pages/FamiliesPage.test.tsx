import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FamiliesPage from './FamiliesPage';
import * as familyService from '../services/familyService';
import { useFamilyStore } from '../store/useFamilyStore';

vi.mock('../store/useAuthStore', () => ({
  useAuthStore: () => ({ user: { id: 'user-1', name: 'User', email: 'user@example.com' } }),
}));

vi.mock('../services/familyService', () => ({
  getFamilies: vi.fn(),
  createFamily: vi.fn(),
  inviteMember: vi.fn(),
  removeMember: vi.fn(),
}));

const familyServiceMock = vi.mocked(familyService);
const family = {
  id: 'family-1',
  name: '测试家庭',
  timezone: 'Asia/Shanghai',
  baseCurrency: 'CNY',
  createdAt: '2026-08-31T00:00:00.000Z',
  updatedAt: '2026-08-31T00:00:00.000Z',
  members: [{ id: 'member-1', familyId: 'family-1', userId: 'user-1', role: 'admin' as const, createdAt: '2026-08-31T00:00:00.000Z', user: { id: 'user-1', name: 'User', email: 'user@example.com' } }],
};

describe('FamiliesPage timezone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    familyServiceMock.getFamilies.mockResolvedValue([family]);
    familyServiceMock.createFamily.mockResolvedValue({ ...family, id: 'family-2', name: 'Test' });
    useFamilyStore.setState({ currentFamily: family, families: [family] });
  });

  it('defaults the create form to Shanghai and submits a selected IANA timezone', async () => {
    render(<FamiliesPage />);
    await screen.findByText('测试家庭');
    fireEvent.click(screen.getByRole('button', { name: /创建家庭/ }));
    expect(screen.getByLabelText(/时区/)).toHaveValue('Asia/Shanghai');
    fireEvent.change(screen.getByLabelText(/时区/), { target: { value: 'America/New_York' } });
    fireEvent.change(screen.getByLabelText(/家庭名称/), { target: { value: 'Test' } });
    fireEvent.click(screen.getByRole('button', { name: /^创建$/ }));
    await waitFor(() => expect(familyServiceMock.createFamily).toHaveBeenCalledWith('Test', '', 'America/New_York'));
  });

  it('shows an existing family timezone without an edit control', async () => {
    render(<FamiliesPage />);
    expect(await screen.findByText('Asia/Shanghai')).toBeVisible();
    expect(screen.queryByRole('button', { name: /修改时区/ })).toBeNull();
  });
});

import type { SearchProfile } from '@jobradar/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { createProfile, updateProfile, deleteProfile } = vi.hoisted(() => ({
  createProfile: vi.fn(),
  updateProfile: vi.fn(),
  deleteProfile: vi.fn(),
}));

vi.mock('@/lib/profiles', () => ({ createProfile, updateProfile, deleteProfile }));

import { ProfilesManager } from './profiles-manager';

function profile(overrides: Partial<SearchProfile> = {}): SearchProfile {
  return {
    id: 'p1',
    name: 'Senior React',
    keywords: ['react'],
    stack: [],
    workFormat: ['remote'],
    employmentType: [],
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    isActive: true,
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('ProfilesManager', () => {
  afterEach(() => vi.clearAllMocks());

  it('renders existing profiles', () => {
    render(<ProfilesManager initial={[profile()]} />);
    expect(screen.getByText('Senior React')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('shows an empty state with no profiles', () => {
    render(<ProfilesManager initial={[]} />);
    expect(screen.getByText(/No search profiles yet/i)).toBeTruthy();
  });

  it('creates a profile and prepends it to the list', async () => {
    createProfile.mockResolvedValue(profile({ id: 'p2', name: 'Backend Go' }));
    render(<ProfilesManager initial={[]} />);

    fireEvent.click(screen.getByRole('button', { name: 'New profile' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Backend Go' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create profile' }));

    await waitFor(() => expect(createProfile).toHaveBeenCalledTimes(1));
    expect(createProfile.mock.calls[0]?.[0]).toMatchObject({ name: 'Backend Go' });
    expect(screen.getByText('Backend Go')).toBeTruthy();
  });

  it('deletes a profile after confirmation', async () => {
    deleteProfile.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ProfilesManager initial={[profile()]} />);

    const card = screen.getByText('Senior React').closest('li') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteProfile).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(screen.queryByText('Senior React')).toBeNull());
  });
});

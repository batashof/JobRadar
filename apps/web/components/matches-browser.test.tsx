import type { MatchFeed, MatchListItem, MatchProfileOption, VacancyListItem } from '@jobradar/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { fetchMatches, createApplication } = vi.hoisted(() => ({
  fetchMatches: vi.fn(),
  createApplication: vi.fn(),
}));

vi.mock('@/lib/matches', () => ({ fetchMatches }));
vi.mock('@/lib/applications', () => ({ createApplication }));

import { MatchesBrowser } from './matches-browser';

const PROFILES: MatchProfileOption[] = [
  { id: 'p1', name: 'Senior React remote', isActive: true, count: 12 },
  { id: 'p2', name: 'Python backend', isActive: true, count: 3 },
];

function vacancy(overrides: Partial<VacancyListItem> = {}): VacancyListItem {
  return {
    id: 'v1',
    url: 'https://t.me/job_react/100',
    title: 'Senior React Engineer',
    company: 'Acme',
    description: 'Build things with React.',
    source: 'telegram',
    workFormat: 'remote',
    employmentType: 'full_time',
    salaryMin: 5000,
    salaryMax: 8000,
    salaryCurrency: 'USD',
    location: 'Remote',
    publishedAt: '2026-07-18T00:00:00.000Z',
    ...overrides,
  };
}

function match(overrides: Partial<MatchListItem> = {}): MatchListItem {
  return {
    vacancy: vacancy(),
    profileId: 'p1',
    profileName: 'Senior React remote',
    score: 0.87,
    matchedAt: '2026-07-20T00:00:00.000Z',
    resumeScore: null,
    resumeExplanation: null,
    ...overrides,
  };
}

function feed(overrides: Partial<MatchFeed> = {}): MatchFeed {
  return { items: [match()], total: 1, page: 1, pageSize: 20, ...overrides };
}

describe('MatchesBrowser', () => {
  afterEach(() => vi.clearAllMocks());

  it('renders the initial page with score badges without fetching', () => {
    render(<MatchesBrowser initial={feed()} profiles={PROFILES} trackedIds={[]} />);
    expect(screen.getByText('Senior React Engineer')).toBeTruthy();
    expect(screen.getByText('87% match')).toBeTruthy();
    expect(fetchMatches).not.toHaveBeenCalled();
  });

  it('shows the profile name on cards when browsing all profiles', () => {
    render(<MatchesBrowser initial={feed()} profiles={PROFILES} trackedIds={[]} />);
    // Once on the filter button, once on the card badge.
    expect(screen.getAllByText(/Senior React remote/)).toHaveLength(2);
  });

  it('filters by profile via the profile buttons', async () => {
    fetchMatches.mockResolvedValue(feed({ total: 12 }));
    render(<MatchesBrowser initial={feed()} profiles={PROFILES} trackedIds={[]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Python backend (3)' }));

    await waitFor(() => expect(fetchMatches).toHaveBeenCalledTimes(1));
    expect(fetchMatches).toHaveBeenCalledWith('p2', 1);
  });

  it('paginates to the next page', async () => {
    fetchMatches.mockResolvedValue(feed({ page: 2, total: 40 }));
    render(<MatchesBrowser initial={feed({ total: 40 })} profiles={PROFILES} trackedIds={[]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(fetchMatches).toHaveBeenCalledTimes(1));
    expect(fetchMatches).toHaveBeenCalledWith(null, 2);
  });

  it('saves a matched vacancy to the board', async () => {
    createApplication.mockResolvedValue({ id: 'a1' });
    render(<MatchesBrowser initial={feed()} profiles={PROFILES} trackedIds={[]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(createApplication).toHaveBeenCalledWith('v1'));
    await waitFor(() => expect(screen.getByText('On board ✓')).toBeTruthy());
  });

  it('prompts to create a profile when there are none', () => {
    render(
      <MatchesBrowser initial={feed({ items: [], total: 0 })} profiles={[]} trackedIds={[]} />,
    );
    expect(screen.getByText(/No active search profiles yet/)).toBeTruthy();
  });
});

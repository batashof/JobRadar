import type { VacancyFeed, VacancyListItem } from '@jobradar/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { fetchFeed, createApplication } = vi.hoisted(() => ({
  fetchFeed: vi.fn(),
  createApplication: vi.fn(),
}));

vi.mock('@/lib/vacancies', () => ({
  fetchFeed,
  EMPTY_FILTERS: { q: '', workFormat: [], employmentType: [], sources: [], salaryMin: null },
}));
vi.mock('@/lib/applications', () => ({ createApplication }));

import type { SourceOption } from '@jobradar/shared';

import { FeedBrowser } from './feed-browser';

const SOURCES: SourceOption[] = [
  { slug: 'remoteok', count: 90 },
  { slug: 'weworkremotely', count: 38 },
];

function item(overrides: Partial<VacancyListItem> = {}): VacancyListItem {
  return {
    id: 'v1',
    url: 'https://example.com/job',
    title: 'Senior React Engineer',
    company: 'Acme',
    description: 'Build things with React.',
    source: 'remoteok',
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

function feed(overrides: Partial<VacancyFeed> = {}): VacancyFeed {
  return { items: [item()], total: 1, page: 1, pageSize: 20, ...overrides };
}

describe('FeedBrowser', () => {
  afterEach(() => vi.clearAllMocks());

  it('renders the server-provided initial page without fetching', () => {
    render(<FeedBrowser initial={feed()} trackedIds={[]} sourceOptions={SOURCES} />);
    expect(screen.getByText('Senior React Engineer')).toBeTruthy();
    expect(screen.getByText('1 vacancy')).toBeTruthy();
    expect(fetchFeed).not.toHaveBeenCalled();
  });

  it('fetches with the query when the user searches', async () => {
    fetchFeed.mockResolvedValue(feed({ items: [item({ id: 'v2', title: 'Go Backend' })], total: 1 }));
    render(<FeedBrowser initial={feed()} trackedIds={[]} sourceOptions={SOURCES} />);

    fireEvent.change(screen.getByLabelText('Search vacancies'), { target: { value: 'go' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(fetchFeed).toHaveBeenCalledTimes(1));
    expect(fetchFeed.mock.calls[0]?.[0]).toMatchObject({ q: 'go' });
    expect(fetchFeed.mock.calls[0]?.[1]).toBe(1);
    await waitFor(() => expect(screen.getByText('Go Backend')).toBeTruthy());
  });

  it('paginates to the next page', async () => {
    fetchFeed.mockResolvedValue(feed({ page: 2, total: 40 }));
    render(<FeedBrowser initial={feed({ total: 40 })} trackedIds={[]} sourceOptions={SOURCES} />);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(fetchFeed).toHaveBeenCalledTimes(1));
    expect(fetchFeed.mock.calls[0]?.[1]).toBe(2);
  });

  it('saves a vacancy to the board and marks it tracked', async () => {
    createApplication.mockResolvedValue({ id: 'a1' });
    render(<FeedBrowser initial={feed()} trackedIds={[]} sourceOptions={SOURCES} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(createApplication).toHaveBeenCalledWith('v1'));
    await waitFor(() => expect(screen.getByText('On board ✓')).toBeTruthy());
  });

  it('filters by source via the checkboxes', async () => {
    fetchFeed.mockResolvedValue(feed());
    render(<FeedBrowser initial={feed()} trackedIds={[]} sourceOptions={SOURCES} />);

    fireEvent.click(screen.getByRole('checkbox', { name: /RemoteOK/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(fetchFeed).toHaveBeenCalledTimes(1));
    expect(fetchFeed.mock.calls[0]?.[0]).toMatchObject({ sources: ['remoteok'] });
  });

  it('shows already-tracked vacancies as on the board', () => {
    render(<FeedBrowser initial={feed()} trackedIds={['v1']} sourceOptions={SOURCES} />);
    expect(screen.getByText('On board ✓')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});

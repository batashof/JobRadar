import type { VacancyFeed, VacancyListItem } from '@jobradar/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { fetchFeed } = vi.hoisted(() => ({ fetchFeed: vi.fn() }));

vi.mock('@/lib/vacancies', () => ({
  fetchFeed,
  EMPTY_FILTERS: { q: '', workFormat: [], employmentType: [], salaryMin: null },
}));

import { FeedBrowser } from './feed-browser';

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
    render(<FeedBrowser initial={feed()} />);
    expect(screen.getByText('Senior React Engineer')).toBeTruthy();
    expect(screen.getByText('1 vacancy')).toBeTruthy();
    expect(fetchFeed).not.toHaveBeenCalled();
  });

  it('fetches with the query when the user searches', async () => {
    fetchFeed.mockResolvedValue(feed({ items: [item({ id: 'v2', title: 'Go Backend' })], total: 1 }));
    render(<FeedBrowser initial={feed()} />);

    fireEvent.change(screen.getByLabelText('Search vacancies'), { target: { value: 'go' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(fetchFeed).toHaveBeenCalledTimes(1));
    expect(fetchFeed.mock.calls[0]?.[0]).toMatchObject({ q: 'go' });
    expect(fetchFeed.mock.calls[0]?.[1]).toBe(1);
    await waitFor(() => expect(screen.getByText('Go Backend')).toBeTruthy());
  });

  it('paginates to the next page', async () => {
    fetchFeed.mockResolvedValue(feed({ page: 2, total: 40 }));
    render(<FeedBrowser initial={feed({ total: 40 })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(fetchFeed).toHaveBeenCalledTimes(1));
    expect(fetchFeed.mock.calls[0]?.[1]).toBe(2);
  });
});

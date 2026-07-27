import type { SourceOption, VacancyFeed, VacancyListItem } from '@jobradar/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { fetchFeed, createApplication, hideVacancy, unhideVacancy } = vi.hoisted(() => ({
  fetchFeed: vi.fn(),
  createApplication: vi.fn(),
  hideVacancy: vi.fn(),
  unhideVacancy: vi.fn(),
}));

vi.mock('@/lib/vacancies', () => ({
  fetchFeed,
  hideVacancy,
  unhideVacancy,
  EMPTY_FILTERS: {
    q: '',
    workFormat: [],
    employmentType: [],
    sources: [],
    salaryMin: null,
    resumeFit: false,
    includeHidden: false,
  },
}));
vi.mock('@/lib/applications', () => ({ createApplication }));

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

function renderFeed(props: Partial<Parameters<typeof FeedBrowser>[0]> = {}) {
  return render(
    <FeedBrowser
      initial={props.initial ?? feed()}
      trackedIds={props.trackedIds ?? []}
      hiddenIds={props.hiddenIds ?? []}
      sourceOptions={props.sourceOptions ?? SOURCES}
      hasResume={props.hasResume ?? false}
    />,
  );
}

describe('FeedBrowser', () => {
  afterEach(() => vi.clearAllMocks());

  it('renders the server-provided initial page without fetching', () => {
    renderFeed();
    expect(screen.getByText('Senior React Engineer')).toBeTruthy();
    expect(screen.getByText('1 vacancy')).toBeTruthy();
    expect(fetchFeed).not.toHaveBeenCalled();
  });

  it('fetches with the query when the user searches', async () => {
    fetchFeed.mockResolvedValue(feed({ items: [item({ id: 'v2', title: 'Go Backend' })], total: 1 }));
    renderFeed();

    fireEvent.change(screen.getByLabelText('Search vacancies'), { target: { value: 'go' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(fetchFeed).toHaveBeenCalledTimes(1));
    expect(fetchFeed.mock.calls[0]?.[0]).toMatchObject({ q: 'go' });
    expect(fetchFeed.mock.calls[0]?.[1]).toBe(1);
    await waitFor(() => expect(screen.getByText('Go Backend')).toBeTruthy());
  });

  it('paginates to the next page', async () => {
    fetchFeed.mockResolvedValue(feed({ page: 2, total: 40 }));
    renderFeed({ initial: feed({ total: 40 }) });

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(fetchFeed).toHaveBeenCalledTimes(1));
    expect(fetchFeed.mock.calls[0]?.[1]).toBe(2);
  });

  it('saves a vacancy to the board and marks it tracked', async () => {
    createApplication.mockResolvedValue({ id: 'a1' });
    renderFeed();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(createApplication).toHaveBeenCalledWith('v1'));
    await waitFor(() => expect(screen.getByText('On board ✓')).toBeTruthy());
  });

  it('filters by source via the checkboxes', async () => {
    fetchFeed.mockResolvedValue(feed());
    renderFeed();

    fireEvent.click(screen.getByRole('checkbox', { name: /RemoteOK/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(fetchFeed).toHaveBeenCalledTimes(1));
    expect(fetchFeed.mock.calls[0]?.[0]).toMatchObject({ sources: ['remoteok'] });
  });

  it('shows already-tracked vacancies as on the board', () => {
    renderFeed({ trackedIds: ['v1'] });
    expect(screen.getByText('On board ✓')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('hides the resume-level toggle without an active resume', () => {
    renderFeed();
    expect(screen.queryByRole('checkbox', { name: /below my level/i })).toBeNull();
  });

  it('refetches with resumeFit when the level toggle is enabled', async () => {
    fetchFeed.mockResolvedValue(feed());
    renderFeed({ hasResume: true });

    fireEvent.click(screen.getByRole('checkbox', { name: /below my level/i }));

    await waitFor(() => expect(fetchFeed).toHaveBeenCalledTimes(1));
    expect(fetchFeed.mock.calls[0]?.[0]).toMatchObject({ resumeFit: true });
  });

  it('hides a vacancy: it disappears from the feed and the API is called', async () => {
    hideVacancy.mockResolvedValue(undefined);
    renderFeed();

    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));

    await waitFor(() => expect(hideVacancy).toHaveBeenCalledWith('v1'));
    expect(screen.queryByText('Senior React Engineer')).toBeNull();
  });

  it('refetches with includeHidden and shows an Unhide control when showing hidden', async () => {
    fetchFeed.mockResolvedValue(feed());
    renderFeed({ hiddenIds: ['v1'] });

    fireEvent.click(screen.getByRole('checkbox', { name: /Show hidden/i }));

    await waitFor(() => expect(fetchFeed).toHaveBeenCalledTimes(1));
    expect(fetchFeed.mock.calls[0]?.[0]).toMatchObject({ includeHidden: true });
    expect(screen.getByRole('button', { name: 'Unhide' })).toBeTruthy();
  });
});

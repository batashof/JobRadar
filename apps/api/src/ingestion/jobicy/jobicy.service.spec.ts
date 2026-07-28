import { JobicyIngestService } from './jobicy.service';
import type { JobicyItem } from './jobicy-normalize';
import * as vacancyUpsert from '../vacancy-upsert';
import type { sources } from '../../db/schema';

const FEEDS = [
  'https://jobicy.com/api/v2/remote-jobs?industry=dev&count=50',
  'https://jobicy.com/api/v2/remote-jobs?industry=data-science&count=50',
];

const source = {
  id: '00000000-0000-0000-0000-000000000006',
  slug: 'jobicy',
  config: { feedUrls: FEEDS },
} as unknown as typeof sources.$inferSelect;

const job = (id: number): JobicyItem => ({
  id,
  url: `https://jobicy.com/jobs/${id}-senior-engineer`,
  jobTitle: 'Senior Engineer',
  companyName: 'Acme Inc',
  jobType: ['Full-Time'],
  jobDescription: `<p>${'You will own the React component library end to end. '.repeat(5)}</p>`,
});

const feed = (jobs: JobicyItem[]): Response =>
  ({ ok: true, status: 200, json: () => Promise.resolve({ jobs }) }) as unknown as Response;

describe('JobicyIngestService', () => {
  let fetchMock: jest.SpyInstance;
  let upsertMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
    upsertMock = jest.spyOn(vacancyUpsert, 'upsertVacancies').mockResolvedValue(0);
  });

  afterEach(() => {
    fetchMock.mockRestore();
    upsertMock.mockRestore();
  });

  const service = () => new JobicyIngestService({} as never);

  it('fetches every industry feed and dedupes jobs listed in both', async () => {
    fetchMock
      .mockResolvedValueOnce(feed([job(1), job(2)]))
      .mockResolvedValueOnce(feed([job(2), job(3)]));

    const result = await service().ingest(source);

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(FEEDS);
    expect(result.fetched).toBe(3);
  });

  it('falls back to the legacy single-feed config', async () => {
    fetchMock.mockResolvedValue(feed([job(1)]));

    await service().ingest({ ...source, config: { feedUrl: FEEDS[0] } } as typeof source);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(FEEDS[0]);
  });

  it('throws when a feed fails so the source is marked errored', async () => {
    fetchMock
      .mockResolvedValueOnce(feed([job(1)]))
      .mockResolvedValueOnce({ ok: false, status: 429, statusText: 'Too Many Requests' } as Response);

    await expect(service().ingest(source)).rejects.toThrow('jobicy request failed: 429');
  });
});

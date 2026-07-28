import { HimalayasIngestService } from './himalayas.service';
import type { HimalayasItem } from './himalayas-normalize';
import * as vacancyUpsert from '../vacancy-upsert';
import type { sources } from '../../db/schema';

const source = {
  id: '00000000-0000-0000-0000-000000000008',
  slug: 'himalayas',
  config: { feedUrl: 'https://himalayas.app/jobs/api', pages: 3 },
  lastRunAt: null,
} as unknown as typeof sources.$inferSelect;

const body = `<p>${'We are hiring a senior backend engineer to own our Go services. '.repeat(6)}</p>`;

const devJob = (n: number): HimalayasItem => ({
  title: `Senior Software Engineer ${n}`,
  companyName: 'Acme Inc.',
  employmentType: 'Full Time',
  salaryPeriod: 'annual',
  minSalary: 120000,
  currency: 'USD',
  parentCategories: ['Developer'],
  categories: ['Backend-Engineering'],
  description: body,
  pubDate: 1785224423,
  guid: `https://himalayas.app/companies/acme/jobs/dev-${n}`,
  applicationLink: `https://himalayas.app/companies/acme/jobs/dev-${n}`,
});

const nurseJob: HimalayasItem = {
  ...devJob(999),
  title: 'Licensed Clinical Social Worker',
  parentCategories: ['Healthcare'],
  categories: ['Mental-Health-Therapist'],
  guid: 'https://himalayas.app/companies/care/jobs/lcsw',
  applicationLink: 'https://himalayas.app/companies/care/jobs/lcsw',
};

const page = (jobs: HimalayasItem[]): Response =>
  ({ ok: true, status: 200, json: () => Promise.resolve({ jobs }) }) as unknown as Response;

const fullPage = (offset: number): HimalayasItem[] =>
  Array.from({ length: 20 }, (_, i) => devJob(offset + i));

describe('HimalayasIngestService', () => {
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

  const service = () => new HimalayasIngestService({} as never);

  it('pages through the feed and keeps only tech roles', async () => {
    fetchMock
      .mockResolvedValueOnce(page(fullPage(0)))
      .mockResolvedValueOnce(page([...fullPage(20).slice(0, 19), nurseJob]))
      .mockResolvedValueOnce(page(fullPage(40)));

    const result = await service().ingest(source);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toContain('offset=20');
    // 60 fetched, one of which is a healthcare posting.
    expect(result.fetched).toBe(59);
  });

  it('stops early on a short page instead of paging into nothing', async () => {
    fetchMock.mockResolvedValueOnce(page(fullPage(0))).mockResolvedValueOnce(page([devJob(20)]));

    const result = await service().ingest(source);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.fetched).toBe(21);
  });

  it('dedupes postings repeated across pages', async () => {
    fetchMock
      .mockResolvedValueOnce(page(fullPage(0)))
      .mockResolvedValueOnce(page(fullPage(0)))
      .mockResolvedValueOnce(page([]));

    const result = await service().ingest(source);

    expect(result.fetched).toBe(20);
  });

  it('throws on a failed request so the source is marked errored', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    } as Response);

    await expect(service().ingest(source)).rejects.toThrow('himalayas request failed: 503');
  });
});

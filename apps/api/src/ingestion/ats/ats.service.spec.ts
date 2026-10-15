import { AtsIngestService } from './ats.service';
import type { AtsCompany } from './ats-normalize';
import * as vacancyUpsert from '../vacancy-upsert';
import type { sources } from '../../db/schema';

const COMPANIES: AtsCompany[] = [
  { ats: 'greenhouse', token: 'gitlab', name: 'GitLab' },
  { ats: 'ashby', token: 'vanta', name: 'Vanta' },
  { ats: 'lever', token: 'veeva', name: 'Veeva Systems' },
];

const source = {
  id: '00000000-0000-0000-0000-00000000000a',
  slug: 'ats',
  config: { companies: COMPANIES },
} as unknown as typeof sources.$inferSelect;

const BODY = 'You will own our Go services end to end and mentor two engineers. '.repeat(5);

const greenhousePayload = {
  jobs: [
    {
      id: 1,
      title: 'Senior Backend Engineer',
      absolute_url: 'https://job-boards.greenhouse.io/gitlab/jobs/1',
      location: { name: 'Remote, Germany' },
      content: `<p>${BODY}</p>`,
      first_published: '2026-07-01T00:00:00Z',
    },
    // Filtered out: not remote.
    { id: 2, title: 'Backend Engineer', location: { name: 'Berlin' }, content: `<p>${BODY}</p>` },
  ],
};

const ashbyPayload = {
  jobs: [
    {
      id: 'a1',
      title: 'Platform Engineer',
      department: 'Engineering',
      workplaceType: 'Remote',
      location: 'Remote',
      jobUrl: 'https://jobs.ashbyhq.com/Vanta/a1',
      descriptionHtml: `<p>${BODY}</p>`,
      publishedAt: '2026-07-02T00:00:00Z',
    },
  ],
};

const leverPayload = [
  {
    id: 'l1',
    text: 'Software Engineer',
    hostedUrl: 'https://jobs.lever.co/veeva/l1',
    workplaceType: 'remote',
    description: `<div>${BODY}</div>`,
    categories: { team: 'Engineering', location: 'Portugal - Lisbon', commitment: 'Permanent' },
    createdAt: 1784569799619,
  },
];

const ok = (payload: unknown): Response =>
  ({ ok: true, status: 200, json: () => Promise.resolve(payload) }) as unknown as Response;
const fail = (status: number): Response => ({ ok: false, status }) as Response;

describe('AtsIngestService', () => {
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

  const service = () => new AtsIngestService({} as never);

  it('calls the right endpoint per ATS and collects every board', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(greenhousePayload))
      .mockResolvedValueOnce(ok(ashbyPayload))
      .mockResolvedValueOnce(ok(leverPayload));

    const result = await service().ingest(source);

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls[0]).toBe('https://boards-api.greenhouse.io/v1/boards/gitlab/jobs?content=true');
    expect(urls[1]).toBe(
      'https://api.ashbyhq.com/posting-api/job-board/vanta?includeCompensation=true',
    );
    expect(urls[2]).toBe('https://api.lever.co/v0/postings/veeva?mode=json');
    // The Berlin posting is filtered out by the adapter.
    expect(result.fetched).toBe(3);
  });

  it('keeps going when a single board is gone', async () => {
    fetchMock
      .mockResolvedValueOnce(fail(404))
      .mockResolvedValueOnce(ok(ashbyPayload))
      .mockResolvedValueOnce(ok(leverPayload));

    const result = await service().ingest(source);

    expect(result.fetched).toBe(2);
    expect(upsertMock).toHaveBeenCalled();
  });

  it('fails the run only when every board is gone', async () => {
    fetchMock.mockResolvedValue(fail(500));

    await expect(service().ingest(source)).rejects.toThrow('every board failed');
  });

  it('skips politely when no company is configured', async () => {
    await expect(
      service().ingest({ ...source, config: {} } as typeof source),
    ).resolves.toEqual({ fetched: 0, upserted: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('smartrecruiters', () => {
    const company: AtsCompany = { ats: 'smartrecruiters', token: 'Canva', name: 'Canva' };
    const srSource = { ...source, config: { companies: [company] } } as typeof source;
    const posting = (id: string, over: Record<string, unknown> = {}) => ({
      id,
      name: 'Senior Frontend Engineer',
      ref: `https://api.smartrecruiters.com/v1/companies/Canva/postings/${id}`,
      releasedDate: `2026-10-0${id}T00:00:00Z`,
      location: { remote: true, hybrid: false, fullLocation: 'Sydney, , Australia' },
      typeOfEmployment: { label: 'Full-time' },
      ...over,
    });
    const detail = (id: string) => ({
      ...posting(id),
      postingUrl: `https://jobs.smartrecruiters.com/Canva/${id}-senior-frontend-engineer`,
      jobAd: {
        sections: {
          companyDescription: { text: 'About Canva' },
          jobDescription: { text: `<p>${BODY}</p>` },
          qualifications: { text: '<p>React, TypeScript</p>' },
        },
      },
    });
    /** Fake drizzle returning the stored external ids. */
    const dbWith = (stored: string[]) =>
      ({
        select: () => ({
          from: () => ({ where: () => Promise.resolve(stored.map((externalId) => ({ externalId }))) }),
        }),
      }) as never;

    it('lists postings, keeps remote tech ones and fetches only their details', async () => {
      fetchMock
        .mockResolvedValueOnce(
          ok({
            totalFound: 3,
            content: [
              posting('1'),
              posting('2', { location: { remote: true, hybrid: true } }),
              posting('3', { name: 'Account Executive' }),
            ],
          }),
        )
        .mockResolvedValueOnce(ok(detail('1')));

      const result = await new AtsIngestService(dbWith([])).ingest(srSource);

      expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
        'https://api.smartrecruiters.com/v1/companies/Canva/postings?limit=100&offset=0',
        'https://api.smartrecruiters.com/v1/companies/Canva/postings/1',
      ]);
      expect(result.fetched).toBe(1);
      const [row] = upsertMock.mock.calls[0][1];
      expect(row).toMatchObject({
        externalId: 'smartrecruiters:Canva:1',
        url: 'https://jobs.smartrecruiters.com/Canva/1-senior-frontend-engineer',
        workFormat: 'remote',
        employmentType: 'full_time',
        location: 'Sydney, Australia',
      });
      expect(row.description).toContain('React, TypeScript');
      expect(row.description).not.toContain('About Canva');
    });

    it('skips the detail request for postings already stored', async () => {
      fetchMock.mockResolvedValueOnce(ok({ totalFound: 1, content: [posting('1')] }));
      const result = await new AtsIngestService(dbWith(['smartrecruiters:Canva:1'])).ingest(srSource);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.fetched).toBe(0);
    });
  });
});

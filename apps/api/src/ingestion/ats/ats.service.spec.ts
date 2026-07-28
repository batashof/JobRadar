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
});

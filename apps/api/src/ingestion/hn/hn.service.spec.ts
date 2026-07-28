import { HnIngestService } from './hn.service';
import type { HnComment } from './hn-normalize';
import * as vacancyUpsert from '../vacancy-upsert';
import type { sources } from '../../db/schema';

const source = {
  id: '00000000-0000-0000-0000-000000000009',
  slug: 'hn',
  config: { apiBaseUrl: 'https://hn.algolia.com/api/v1', threads: 2 },
} as unknown as typeof sources.$inferSelect;

const BODY = 'We are a small team building payment rails. '.repeat(6);

const post = (id: number, storyId: number): HnComment => ({
  objectID: String(id),
  parent_id: storyId,
  story_id: storyId,
  comment_text: `Acme ${id} | Platform Engineer | Full-Time | Remote (US)<p>${BODY}`,
  created_at: '2026-07-15T09:12:00.000Z',
});

const json = (payload: unknown): Response =>
  ({ ok: true, status: 200, json: () => Promise.resolve(payload) }) as unknown as Response;

const stories = (titles: Array<[string, string]>) =>
  json({ hits: titles.map(([objectID, title]) => ({ objectID, title })) });

describe('HnIngestService', () => {
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

  const service = () => new HnIngestService({} as never);

  it('walks the configured number of hiring threads and skips the other monthly posts', async () => {
    fetchMock
      .mockResolvedValueOnce(
        stories([
          ['100', 'Ask HN: Who wants to be hired? (July 2026)'],
          ['101', 'Ask HN: Who is hiring? (July 2026)'],
          ['102', 'Ask HN: Freelancer? Seeking freelancer? (July 2026)'],
          ['103', 'Ask HN: Who is hiring? (June 2026)'],
          ['104', 'Ask HN: Who is hiring? (May 2026)'],
        ]),
      )
      .mockResolvedValueOnce(json({ hits: [post(1, 101)], nbPages: 1 }))
      .mockResolvedValueOnce(json({ hits: [post(2, 103)], nbPages: 1 }));

    const result = await service().ingest(source);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toContain('story_101');
    expect(fetchMock.mock.calls[2]?.[0]).toContain('story_103');
    expect(result.fetched).toBe(2);
  });

  it('pages through a thread and keeps only its top-level comments', async () => {
    const reply: HnComment = { ...post(9, 101), parent_id: 555 };
    fetchMock
      .mockResolvedValueOnce(stories([['101', 'Ask HN: Who is hiring? (July 2026)']]))
      .mockResolvedValueOnce(json({ hits: [post(1, 101), reply], nbPages: 2 }))
      .mockResolvedValueOnce(json({ hits: [post(2, 101)], nbPages: 2 }));

    const result = await service().ingest({ ...source, config: { threads: 1 } } as typeof source);

    expect(fetchMock.mock.calls[2]?.[0]).toContain('page=1');
    expect(result.fetched).toBe(2);
  });

  it('returns nothing when no hiring thread is found instead of failing the run', async () => {
    fetchMock.mockResolvedValueOnce(stories([['100', 'Ask HN: Who wants to be hired?']]));

    await expect(service().ingest(source)).resolves.toEqual({ fetched: 0, upserted: 0 });
  });

  it('throws on a failed request so the source is marked errored', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    } as Response);

    await expect(service().ingest(source)).rejects.toThrow('hn request failed: 503');
  });
});

import { WwrIngestService } from './wwr.service';
import * as vacancyUpsert from '../vacancy-upsert';
import type { sources } from '../../db/schema';

const FEEDS = [
  'https://weworkremotely.com/categories/remote-programming-jobs.rss',
  'https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss',
];

const source = {
  id: '00000000-0000-0000-0000-000000000003',
  slug: 'weworkremotely',
  config: { feedUrls: FEEDS },
  lastRunAt: new Date('2026-07-27T00:00:00Z'),
} as unknown as typeof sources.$inferSelect;

const body = 'You will own the whole stack, from the Rails API to the React front-end. '.repeat(4);

const feed = (guids: string[]): Response =>
  ({
    ok: true,
    status: 200,
    text: () =>
      Promise.resolve(
        `<?xml version="1.0"?><rss><channel>${guids
          .map(
            (guid) =>
              `<item><title>Acme: Senior Dev</title><link>${guid}</link><guid>${guid}</guid>` +
              `<description>${body}</description><region>Anywhere</region></item>`,
          )
          .join('')}</channel></rss>`,
      ),
  }) as unknown as Response;

const notModified = () => ({ ok: false, status: 304 }) as Response;

describe('WwrIngestService', () => {
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

  const service = () => new WwrIngestService({} as never);

  it('fetches every configured feed and dedupes overlapping postings', async () => {
    fetchMock
      .mockResolvedValueOnce(feed(['https://wwr/a', 'https://wwr/b']))
      .mockResolvedValueOnce(feed(['https://wwr/b', 'https://wwr/c']));

    const result = await service().ingest(source);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(FEEDS);
    expect(result.fetched).toBe(3);
  });

  it('sends a conditional GET based on the last run', async () => {
    fetchMock.mockResolvedValue(feed(['https://wwr/a']));

    await service().ingest(source);

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['If-Modified-Since']).toBe(source.lastRunAt!.toUTCString());
  });

  it('reports notModified only when every feed is unchanged', async () => {
    fetchMock.mockResolvedValueOnce(notModified()).mockResolvedValueOnce(notModified());
    await expect(service().ingest(source)).resolves.toMatchObject({
      notModified: true,
      fetched: 0,
    });

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(notModified()).mockResolvedValueOnce(feed(['https://wwr/a']));
    const partial = await service().ingest(source);
    expect(partial.notModified).toBeFalsy();
    expect(partial.fetched).toBe(1);
  });

  it('falls back to the legacy single-feed config', async () => {
    fetchMock.mockResolvedValue(feed(['https://wwr/a']));
    const legacy = { ...source, config: { feedUrl: FEEDS[0] } } as typeof source;

    await service().ingest(legacy);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(FEEDS[0]);
  });
});

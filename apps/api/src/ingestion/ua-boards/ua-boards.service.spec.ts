import type { sources } from '../../db/schema';
import * as vacancyUpsert from '../vacancy-upsert';
import { DEFAULT_DOU_CATEGORIES } from './ua-boards-normalize';
import { UaBoardsIngestService } from './ua-boards.service';

const body = 'You will build the React front end of a payments product with TypeScript. '.repeat(4);

const source = (slug: string, config: unknown = null) =>
  ({ id: 'src-1', slug, config }) as unknown as typeof sources.$inferSelect;

const feed = (links: string[]): Response =>
  ({
    ok: true,
    status: 200,
    text: () =>
      Promise.resolve(
        `<?xml version="1.0"?><rss><channel>${links
          .map(
            (link) =>
              `<item><title>Senior Developer</title><link>${link}</link><guid>${link}</guid>` +
              `<description>${body}</description><pubDate>Thu, 15 Oct 2026 13:07:28 +0300</pubDate></item>`,
          )
          .join('')}</channel></rss>`,
      ),
  }) as unknown as Response;

describe('UaBoardsIngestService', () => {
  let fetchMock: jest.SpyInstance;
  let upsertMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
    upsertMock = jest.spyOn(vacancyUpsert, 'upsertVacancies').mockImplementation(
      (_db, rows) => Promise.resolve(rows.length),
    );
  });

  afterEach(() => {
    fetchMock.mockRestore();
    upsertMock.mockRestore();
  });

  const service = () => new UaBoardsIngestService({} as never);

  it('reads every Djinni keyword feed and dedupes postings listed twice', async () => {
    fetchMock
      .mockResolvedValueOnce(feed(['https://djinni.co/jobs/1-a/', 'https://djinni.co/jobs/2-b/']))
      .mockResolvedValueOnce(feed(['https://djinni.co/jobs/2-b/', 'https://djinni.co/jobs/3-c/']));

    const result = await service().ingestDjinni(
      source('djinni', { keywords: ['JavaScript', 'React.js'] }),
    );

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://djinni.co/jobs/rss/?primary_keyword=JavaScript',
      'https://djinni.co/jobs/rss/?primary_keyword=React.js',
    ]);
    expect(result).toEqual({ fetched: 3, upserted: 3 });
  });

  it('uses the default DOU categories and encodes them', async () => {
    fetchMock.mockResolvedValue(feed([]));
    await service().ingestDou(source('dou'));
    expect(fetchMock).toHaveBeenCalledTimes(DEFAULT_DOU_CATEGORIES.length);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://jobs.dou.ua/vacancies/feeds/?category=Front%20End',
    );
  });

  it('skips a failing feed but keeps the others', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response)
      .mockResolvedValueOnce(feed(['https://jobs.dou.ua/companies/a/vacancies/7/']));
    const result = await service().ingestDou(source('dou', { categories: ['QA', 'Java'] }));
    expect(result.fetched).toBe(1);
  });

  it('fails the run when every feed fails', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(
      service().ingestDou(source('dou', { categories: ['QA', 'Java'] })),
    ).rejects.toThrow('every feed failed');
  });
});

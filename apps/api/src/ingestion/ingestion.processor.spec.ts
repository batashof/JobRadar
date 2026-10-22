import * as Sentry from '@sentry/nestjs';

import { IngestionProcessor } from './ingestion.processor';
import type { IngestJobData } from './ingestion.types';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

const captureExceptionMock = Sentry.captureException as jest.MockedFunction<
  typeof Sentry.captureException
>;

const job = (data: IngestJobData): IngestJobData => data;

describe('IngestionProcessor error handling', () => {
  const activeSource = {
    id: 1,
    slug: 'remoteok',
    isActive: true,
    lastRunAt: null,
    lastRunStatus: null,
  };

  const makeProcessor = (
    worker: { ingest: jest.Mock },
    uaBoards = { ingestDou: jest.fn(), ingestDjinni: jest.fn() },
  ) => {
    const where = jest.fn().mockResolvedValue(undefined);
    const set = jest.fn().mockReturnValue({ where });
    const db = {
      query: {
        sources: { findFirst: jest.fn().mockResolvedValue(activeSource) },
      },
      update: jest.fn().mockReturnValue({ set }),
    };
    const processor = new IngestionProcessor(
      db as never,
      { ingest: jest.fn() } as never, // hh
      worker as never, // remoteok
      { ingest: jest.fn() } as never, // remotive
      { ingest: jest.fn() } as never, // jobicy
      { ingest: jest.fn() } as never, // himalayas
      { ingest: jest.fn() } as never, // hn
      { ingest: jest.fn() } as never, // ats
      { ingest: jest.fn() } as never, // workingnomads
      { ingest: jest.fn() } as never, // telegram
      { ingest: jest.fn() } as never, // wwr
      { ingest: jest.fn() } as never, // linkedin
      uaBoards as never,
      { run: jest.fn() } as never, // dedup
      { rematchAll: jest.fn().mockResolvedValue({ profiles: 1 }) } as never, // matching
    );
    return { processor, set, db };
  };

  beforeEach(() => captureExceptionMock.mockClear());

  it('reports a source failure to Sentry, marks it error, and rethrows', async () => {
    const boom = new Error('remoteok fetch failed');
    const { processor, set } = makeProcessor({
      ingest: jest.fn().mockRejectedValue(boom),
    });

    await expect(processor.process(job({ kind: 'source', slug: 'remoteok' }))).rejects.toThrow(
      boom,
    );

    expect(captureExceptionMock).toHaveBeenCalledWith(boom, {
      tags: { source: 'remoteok', job: 'ingestion' },
    });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ lastRunStatus: 'error' }));
  });

  it('does not touch Sentry on a successful run', async () => {
    const { processor } = makeProcessor({
      ingest: jest.fn().mockResolvedValue({ fetched: 5, notModified: false }),
    });

    await processor.process(job({ kind: 'source', slug: 'remoteok' }));

    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('routes DOU and Djinni to the Ukrainian boards worker', async () => {
    const uaBoards = {
      ingestDou: jest.fn().mockResolvedValue({ fetched: 2, upserted: 2 }),
      ingestDjinni: jest.fn().mockResolvedValue({ fetched: 3, upserted: 3 }),
    };
    const { processor, db } = makeProcessor({ ingest: jest.fn() }, uaBoards);
    db.query.sources.findFirst
      .mockResolvedValueOnce({ ...activeSource, slug: 'dou' })
      .mockResolvedValueOnce({ ...activeSource, slug: 'djinni' });

    await processor.process(job({ kind: 'source', slug: 'dou' }));
    await processor.process(job({ kind: 'source', slug: 'djinni' }));

    expect(uaBoards.ingestDou).toHaveBeenCalledTimes(1);
    expect(uaBoards.ingestDjinni).toHaveBeenCalledTimes(1);
  });

  it('skips a source that ran within its interval', async () => {
    const worker = { ingest: jest.fn() };
    const { processor, db } = makeProcessor(worker);
    db.query.sources.findFirst.mockResolvedValueOnce({
      ...activeSource,
      lastRunAt: new Date(Date.now() - 30 * 60 * 1000),
      lastRunStatus: 'ok',
    });

    expect(await processor.process(job({ kind: 'source', slug: 'remoteok' }))).toEqual({
      skipped: 'ran-recently',
    });
    expect(worker.ingest).not.toHaveBeenCalled();
  });
});

describe('IngestionProcessor match job', () => {
  it('runs rules matching every time and never an LLM pass (ADR-029)', async () => {
    const rematchAll = jest.fn().mockResolvedValue({ profiles: 1 });
    const noop = { ingest: jest.fn() };
    const processor = new IngestionProcessor(
      {} as never,
      noop as never, // hh
      noop as never, // remoteok
      noop as never, // remotive
      noop as never, // jobicy
      noop as never, // himalayas
      noop as never, // hn
      noop as never, // ats
      noop as never, // workingnomads
      noop as never, // telegram
      noop as never, // wwr
      noop as never, // linkedin
      {} as never, // uaBoards
      { run: jest.fn() } as never,
      { rematchAll } as never,
    );

    const first = await processor.process(job({ kind: 'match' }));
    const second = await processor.process(job({ kind: 'match' }));

    expect(rematchAll).toHaveBeenCalledTimes(2);
    expect(first).toEqual({ profiles: 1 });
    expect(second).toEqual({ profiles: 1 });
  });
});

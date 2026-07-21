import * as Sentry from '@sentry/nestjs';
import type { Job } from 'bullmq';

import { IngestionProcessor } from './ingestion.processor';
import type { IngestJobData } from './ingestion.types';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

const captureExceptionMock = Sentry.captureException as jest.MockedFunction<
  typeof Sentry.captureException
>;

const job = (data: IngestJobData): Job<IngestJobData> => ({ data }) as Job<IngestJobData>;

describe('IngestionProcessor error handling', () => {
  const activeSource = { id: 1, slug: 'remoteok', isActive: true, lastRunAt: null, lastRunStatus: null };

  const makeProcessor = (worker: { ingest: jest.Mock }) => {
    const where = jest.fn().mockResolvedValue(undefined);
    const set = jest.fn().mockReturnValue({ where });
    const db = {
      query: { sources: { findFirst: jest.fn().mockResolvedValue(activeSource) } },
      update: jest.fn().mockReturnValue({ set }),
    };
    const processor = new IngestionProcessor(
      db as never,
      { ingest: jest.fn() } as never, // hh
      worker as never, // remoteok
      { ingest: jest.fn() } as never, // remotive
      { ingest: jest.fn() } as never, // jobicy
      { ingest: jest.fn() } as never, // workingnomads
      { ingest: jest.fn() } as never, // telegram
      { ingest: jest.fn() } as never, // wwr
      { run: jest.fn() } as never, // dedup
      { rematchAll: jest.fn() } as never, // matching
      { scorePending: jest.fn().mockResolvedValue({ scored: 0, remaining: 0 }) } as never, // resume matching
    );
    return { processor, set };
  };

  beforeEach(() => captureExceptionMock.mockClear());

  it('reports a source failure to Sentry, marks it error, and rethrows', async () => {
    const boom = new Error('remoteok fetch failed');
    const { processor, set } = makeProcessor({ ingest: jest.fn().mockRejectedValue(boom) });

    await expect(processor.process(job({ kind: 'source', slug: 'remoteok' }))).rejects.toThrow(boom);

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
});

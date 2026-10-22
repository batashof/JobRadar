import { IngestionQueue } from './ingestion-queue';
import type { IngestJobData } from './ingestion.types';

const source = (slug: string): IngestJobData => ({ kind: 'source', slug });

describe('IngestionQueue (ADR-031)', () => {
  it('runs jobs one at a time, in the order they were added', async () => {
    const log: string[] = [];
    const processor = {
      process: jest.fn(async (data: IngestJobData) => {
        log.push(`start ${data.kind === 'source' ? data.slug : data.kind}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        log.push(`end ${data.kind === 'source' ? data.slug : data.kind}`);
      }),
    };
    const queue = new IngestionQueue(processor as never);

    queue.add('ingest:telegram', source('telegram'));
    queue.add('ingest:linkedin', source('linkedin'));
    queue.add('dedup', { kind: 'dedup' });
    queue.add('match', { kind: 'match' });
    await queue.idle();

    expect(log).toEqual([
      'start telegram',
      'end telegram',
      'start linkedin',
      'end linkedin',
      'start dedup',
      'end dedup',
      'start match',
      'end match',
    ]);
  });

  it('does not wait for the job: the HTTP tick answers first', () => {
    const processor = { process: jest.fn().mockResolvedValue(undefined) };
    const queue = new IngestionQueue(processor as never);

    queue.add('ingest:telegram', source('telegram'));

    expect(processor.process).not.toHaveBeenCalled();
    expect(queue.size()).toBe(1);
  });

  it('keeps going after a failed job', async () => {
    const processor = {
      process: jest
        .fn()
        .mockRejectedValueOnce(new Error('telegram down'))
        .mockResolvedValue(undefined),
    };
    const queue = new IngestionQueue(processor as never);

    queue.add('ingest:telegram', source('telegram'));
    queue.add('dedup', { kind: 'dedup' });
    await queue.idle();

    expect(processor.process).toHaveBeenCalledTimes(2);
    expect(processor.process).toHaveBeenLastCalledWith({ kind: 'dedup' });
  });

  it('skips a job already waiting, so overlapping ticks do not pile up', async () => {
    let release!: () => void;
    const processor = {
      process: jest
        .fn()
        .mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)))
        .mockResolvedValue(undefined),
    };
    const queue = new IngestionQueue(processor as never);

    queue.add('ingest:telegram', source('telegram'));
    queue.add('dedup', { kind: 'dedup' });
    await Promise.resolve();
    await Promise.resolve();
    // The next tick, while telegram is still running: dedup is waiting already.
    expect(queue.add('ingest:telegram', source('telegram'))).toBe(true);
    expect(queue.add('dedup', { kind: 'dedup' })).toBe(false);
    release();
    await queue.idle();

    expect(processor.process.mock.calls.map(([data]) => (data as IngestJobData).kind)).toEqual([
      'source',
      'dedup',
      'source',
    ]);
  });
});

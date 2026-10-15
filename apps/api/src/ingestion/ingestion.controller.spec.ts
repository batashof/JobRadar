import { IngestionController } from './ingestion.controller';

const MIN = 60 * 1000;

describe('IngestionController.run', () => {
  const makeController = (
    rows: {
      slug: string;
      lastRunAt: Date | null;
      lastRunStatus: string | null;
    }[],
  ) => {
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const db = {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(rows) }),
      }),
    };
    return {
      controller: new IngestionController(queue as never, db as never),
      queue,
    };
  };
  const ago = (minutes: number) => new Date(Date.now() - minutes * MIN);

  it('enqueues only the sources that are due, then dedup and match', async () => {
    const { controller, queue } = makeController([
      { slug: 'telegram', lastRunAt: ago(10), lastRunStatus: 'ok' },
      { slug: 'linkedin', lastRunAt: ago(10), lastRunStatus: 'ok' },
      { slug: 'remotive', lastRunAt: ago(30), lastRunStatus: 'ok' },
      { slug: 'ats', lastRunAt: ago(61), lastRunStatus: 'ok' },
    ]);

    const result = await controller.run({});

    expect(result.enqueued).toEqual(['telegram', 'linkedin', 'ats', 'dedup', 'match']);
    expect(queue.add.mock.calls.map((call) => call[0])).toEqual([
      'ingest:telegram',
      'ingest:linkedin',
      'ingest:ats',
      'dedup',
      'match',
    ]);
  });

  it('enqueues nothing when no source is due', async () => {
    const { controller, queue } = makeController([
      { slug: 'telegram', lastRunAt: ago(1), lastRunStatus: 'ok' },
      { slug: 'remotive', lastRunAt: ago(30), lastRunStatus: 'ok' },
    ]);

    expect(await controller.run()).toEqual({ enqueued: [] });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('force enqueues every active source and passes the flag on', async () => {
    const { controller, queue } = makeController([
      { slug: 'telegram', lastRunAt: ago(1), lastRunStatus: 'ok' },
      { slug: 'remotive', lastRunAt: ago(30), lastRunStatus: 'ok' },
    ]);

    const result = await controller.run({ force: true });

    expect(result.enqueued).toEqual(['telegram', 'remotive', 'dedup', 'match']);
    expect(queue.add).toHaveBeenCalledWith(
      'ingest:remotive',
      { kind: 'source', slug: 'remotive', force: true },
      expect.any(Object),
    );
  });
});

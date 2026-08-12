import { DIGEST_DEFAULTS, PLANNER_DEFAULTS } from '@jobradar/shared';

import { digestSettings, plannerSettings } from '../db/schema';
import { DigestService } from './digest.service';

/** One scripted response per `from(table)` call; writes are recorded. */
function makeDb() {
  const queues = new Map<unknown, unknown[][]>();
  const updates: Record<string, unknown>[] = [];
  const inserts: unknown[] = [];
  const upserts: { table: unknown; values: unknown }[] = [];

  const db = {
    select: () => ({
      from: (table: unknown) => {
        let cached: unknown[] | undefined;
        const rows = () => (cached ??= queues.get(table)?.shift() ?? []);
        return { where: () => Promise.resolve(rows()) };
      },
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => ({
        onConflictDoNothing: () => ({
          returning: () => {
            inserts.push(values);
            return Promise.resolve(queues.get(table)?.shift() ?? []);
          },
        }),
        onConflictDoUpdate: () => {
          upserts.push({ table, values });
          return Promise.resolve();
        },
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            updates.push(values);
            return Promise.resolve(queues.get(digestSettings)?.shift() ?? []);
          },
        }),
      }),
    }),
  };

  return {
    db: db as never,
    updates,
    inserts,
    upserts,
    queue: (table: unknown, ...responses: unknown[][]) => queues.set(table, responses),
  };
}

const row = (over: Record<string, unknown> = {}) => ({
  userId: 'user-1',
  enabled: true,
  sendTimes: ['09:00'],
  maxItems: 10,
  minScore: 60,
  ...over,
});

describe('DigestService.getSettings', () => {
  it('returns the stored schedule with the planner timezone', async () => {
    const { db, queue } = makeDb();
    queue(digestSettings, [row({ sendTimes: ['19:00', '09:00'], maxItems: 5, minScore: 70 })]);
    queue(plannerSettings, [{ timezone: 'Europe/Belgrade' }]);

    await expect(new DigestService(db).getSettings('user-1')).resolves.toEqual({
      enabled: true,
      // Stored order is not trusted — the contract is sorted.
      sendTimes: ['09:00', '19:00'],
      maxItems: 5,
      minScore: 70,
      timezone: 'Europe/Belgrade',
    });
  });

  it('creates the row lazily, so the feature needs no explicit enabling', async () => {
    const { db, queue, inserts } = makeDb();
    queue(digestSettings, [], [row()]); // absent, then the freshly inserted row
    queue(plannerSettings, [{ timezone: 'UTC' }]);

    const settings = await new DigestService(db).getSettings('user-1');

    expect(inserts).toEqual([{ userId: 'user-1' }]);
    expect(settings.sendTimes).toEqual([...DIGEST_DEFAULTS.sendTimes]);
    expect(settings.maxItems).toBe(DIGEST_DEFAULTS.maxItems);
  });

  it('falls back to the shared default timezone for a user who never opened the planner', async () => {
    const { db, queue } = makeDb();
    queue(digestSettings, [row()]);
    queue(plannerSettings, []);

    await expect(new DigestService(db).getSettings('user-1')).resolves.toMatchObject({
      timezone: PLANNER_DEFAULTS.timezone,
    });
  });

  it('survives losing the insert race', async () => {
    const { db, queue } = makeDb();
    // absent → insert returns nothing (conflict) → re-read finds the winner's row
    queue(digestSettings, [], [], [row({ maxItems: 3 })]);
    queue(plannerSettings, [{ timezone: 'UTC' }]);

    await expect(new DigestService(db).getSettings('user-1')).resolves.toMatchObject({
      maxItems: 3,
    });
  });
});

describe('DigestService.updateSettings', () => {
  it('sorts the schedule before storing it', async () => {
    const { db, queue, updates } = makeDb();
    queue(digestSettings, [row()], [row({ sendTimes: ['09:00', '19:00'] })]);
    queue(plannerSettings, [{ timezone: 'UTC' }]);

    const settings = await new DigestService(db).updateSettings('user-1', {
      sendTimes: ['19:00', '09:00'],
    });

    expect(updates[0]).toMatchObject({ sendTimes: ['09:00', '19:00'] });
    expect(settings.sendTimes).toEqual(['09:00', '19:00']);
  });

  it('leaves untouched fields alone on a partial update', async () => {
    const { db, queue, updates } = makeDb();
    queue(digestSettings, [row()], [row({ enabled: false })]);
    queue(plannerSettings, [{ timezone: 'UTC' }]);

    await new DigestService(db).updateSettings('user-1', { enabled: false });

    expect(updates[0]).not.toHaveProperty('sendTimes');
    expect(updates[0]).not.toHaveProperty('maxItems');
    expect(updates[0]).toMatchObject({ enabled: false });
  });

  it('stores the timezone on the planner row, not as a second copy', async () => {
    const { db, queue, updates, upserts } = makeDb();
    queue(digestSettings, [row()], [row()]);
    queue(plannerSettings, [{ timezone: 'Europe/Minsk' }]);

    const settings = await new DigestService(db).updateSettings('user-1', {
      sendTimes: ['11:00'],
      timezone: 'Europe/Minsk',
    });

    expect(upserts).toEqual([
      { table: plannerSettings, values: { userId: 'user-1', timezone: 'Europe/Minsk' } },
    ]);
    // The digest row never grows a timezone column of its own.
    expect(updates[0]).not.toHaveProperty('timezone');
    expect(settings.timezone).toBe('Europe/Minsk');
  });

  it('refuses a timezone the runtime does not know', async () => {
    const { db, queue, updates } = makeDb();
    queue(digestSettings, [row()]);

    await expect(
      new DigestService(db).updateSettings('user-1', { timezone: 'Mars/Olympus' }),
    ).rejects.toThrow('Unknown timezone');
    // Rejected before anything was written, so the schedule is untouched.
    expect(updates).toHaveLength(0);
  });

  it('does not touch the planner row when no timezone was sent', async () => {
    const { db, queue, upserts } = makeDb();
    queue(digestSettings, [row()], [row()]);
    queue(plannerSettings, [{ timezone: 'UTC' }]);

    await new DigestService(db).updateSettings('user-1', { minScore: 50 });

    expect(upserts).toHaveLength(0);
  });
});

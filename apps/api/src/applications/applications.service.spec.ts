import { ConflictException, NotFoundException } from '@nestjs/common';

import { applications } from '../db/schema';
import { ApplicationsService } from './applications.service';

/**
 * Fake drizzle: every builder call returns the same chain and is recorded;
 * awaiting a chain resolves to the next scripted response. Enough to pin which
 * rows the service asks for and what it writes, without a database.
 */
function makeDb(...responses: unknown[][]) {
  const queue = [...responses];
  const calls: { op: string; method: string; arg: unknown }[] = [];

  const chain = (op: string) => {
    const proxy: Record<string, unknown> = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === 'then') {
            return (ok: (rows: unknown) => unknown, fail?: (err: unknown) => unknown) =>
              Promise.resolve(queue.shift() ?? []).then(ok, fail);
          }
          return (arg: unknown) => {
            calls.push({ op, method: prop, arg });
            return proxy;
          };
        },
      },
    );
    return proxy;
  };

  const db = {
    select: () => chain('select'),
    update: (table: unknown) => {
      calls.push({ op: 'update', method: 'table', arg: table });
      return chain('update');
    },
  };
  return { db: db as never, calls };
}

const NOW = new Date('2026-10-16T12:00:00Z');

/** One row as `selectItems` reads it. */
function row(over: Record<string, unknown> = {}) {
  return {
    id: 'app-1',
    stage: 'applied',
    stageOrder: 0,
    notes: '',
    appliedAt: NOW,
    lastActivityAt: NOW,
    remindAfterDays: null,
    createdAt: NOW,
    vacancyId: 'vac-1',
    vacancyTitle: 'Node.js Developer',
    vacancyCompany: 'Acme',
    vacancyUrl: 'https://acme.test/1',
    vacancySource: 'djinni',
    ...over,
  };
}

describe('ApplicationsService — bot methods (roadmap 5.5)', () => {
  describe('markApplied', () => {
    it('creates a new application at applied', async () => {
      const { db } = makeDb([]);
      const service = new ApplicationsService(db);
      const created = { id: 'app-1', stage: 'applied' };
      const create = jest.spyOn(service, 'create').mockResolvedValue(created as never);

      const result = await service.markApplied('user-1', 'vac-1');

      expect(create).toHaveBeenCalledWith('user-1', { vacancyId: 'vac-1', stage: 'applied' });
      expect(result).toEqual({ item: created, outcome: 'created' });
    });

    it('moves a saved application to applied', async () => {
      const { db } = makeDb([row({ stage: 'saved' })]);
      const service = new ApplicationsService(db);
      const update = jest
        .spyOn(service, 'update')
        .mockResolvedValue({ id: 'app-1', stage: 'applied' } as never);

      const result = await service.markApplied('user-1', 'vac-1');

      expect(update).toHaveBeenCalledWith('user-1', 'app-1', { stage: 'applied' });
      expect(result.outcome).toBe('moved');
    });

    it('leaves an application further along where it is', async () => {
      const { db } = makeDb([row({ stage: 'tech_interview' })]);
      const service = new ApplicationsService(db);
      const update = jest.spyOn(service, 'update');
      const create = jest.spyOn(service, 'create');

      const result = await service.markApplied('user-1', 'vac-1');

      expect(update).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      expect(result.outcome).toBe('kept');
      expect(result.item.stage).toBe('tech_interview');
      expect(result.item.vacancy.url).toBe('https://acme.test/1');
    });

    it('survives a double tap that raced the first insert', async () => {
      const { db } = makeDb([], [row()]);
      const service = new ApplicationsService(db);
      jest.spyOn(service, 'create').mockRejectedValue(new ConflictException());

      const result = await service.markApplied('user-1', 'vac-1');

      expect(result.outcome).toBe('kept');
      expect(result.item.id).toBe('app-1');
    });

    it('rethrows anything that is not a conflict', async () => {
      const { db } = makeDb([]);
      const service = new ApplicationsService(db);
      jest.spyOn(service, 'create').mockRejectedValue(new Error('db down'));
      await expect(service.markApplied('user-1', 'vac-1')).rejects.toThrow('db down');
    });
  });

  it('get returns the item, or null when it is not the user’s', async () => {
    const { db } = makeDb([row()], []);
    const service = new ApplicationsService(db);
    expect((await service.get('user-1', 'app-1'))?.vacancy.title).toBe('Node.js Developer');
    expect(await service.get('user-1', 'app-2')).toBeNull();
  });

  it('listRecent limits the rows and orders by last activity', async () => {
    const { db, calls } = makeDb([row(), row({ id: 'app-2' })]);
    const service = new ApplicationsService(db);

    const items = await service.listRecent('user-1', false, 10);

    expect(items.map((i) => i.id)).toEqual(['app-1', 'app-2']);
    expect(calls.find((c) => c.method === 'limit')?.arg).toBe(10);
    expect(calls.some((c) => c.method === 'orderBy')).toBe(true);
  });

  it('snooze stamps last activity now, and refuses a missing application', async () => {
    const { db, calls } = makeDb([{ id: 'app-1' }], [row()]);
    const service = new ApplicationsService(db);

    await service.snooze('user-1', 'app-1');

    const set = calls.find((c) => c.op === 'update' && c.method === 'set')?.arg as Record<
      string,
      unknown
    >;
    expect(set.lastActivityAt).toBeInstanceOf(Date);
    expect(set).not.toHaveProperty('remindedAt');

    const missing = new ApplicationsService(makeDb([]).db);
    await expect(missing.snooze('user-1', 'gone')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('markReminded stamps reminded_at', async () => {
    const { db, calls } = makeDb([]);
    await new ApplicationsService(db).markReminded('app-1', NOW);
    expect(calls).toContainEqual({ op: 'update', method: 'table', arg: applications });
    expect(calls).toContainEqual({ op: 'update', method: 'set', arg: { remindedAt: NOW } });
  });

  it('listReminderCandidates normalises the language', async () => {
    const base = {
      id: 'app-1',
      userId: 'user-1',
      stage: 'applied',
      lastActivityAt: NOW,
      remindAfterDays: null,
      remindedAt: null,
      title: 'Node.js Developer',
      company: 'Acme',
      timezone: null,
    };
    const { db, calls } = makeDb([
      { ...base, language: 'en' },
      { ...base, id: 'app-2', language: 'de' },
    ]);

    const rows = await new ApplicationsService(db).listReminderCandidates();

    expect(rows.map((r) => r.language)).toEqual(['en', 'ru']);
    // Joined on a linked chat and the user's timezone.
    expect(calls.filter((c) => c.method === 'innerJoin')).toHaveLength(3);
    expect(calls.filter((c) => c.method === 'leftJoin')).toHaveLength(1);
  });
});

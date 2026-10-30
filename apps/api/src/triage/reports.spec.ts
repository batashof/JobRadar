import { reports } from '../db/schema';
import { recordErrorReport, recordFeedbackReport, setReportStatus } from './reports';

function fakeDb(options: { fail?: boolean; changed?: number } = {}) {
  const calls: { op: string; table?: unknown; values?: unknown; conflict?: { target: unknown; set: Record<string, unknown> } }[] = [];
  const db = {
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        if (options.fail) throw new Error('db down');
        const call: (typeof calls)[number] = { op: 'insert', table, values };
        calls.push(call);
        const done = Promise.resolve();
        return Object.assign(done, {
          onConflictDoUpdate: (conflict: { target: unknown; set: Record<string, unknown> }) => {
            call.conflict = conflict;
            return Promise.resolve();
          },
        });
      },
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: () => ({
          returning: () => {
            calls.push({ op: 'update', table, values });
            return Promise.resolve(Array.from({ length: options.changed ?? 1 }, () => ({ id: 1 })));
          },
        }),
      }),
    }),
  };
  return { db: db as never, calls };
}

describe('reports inbox', () => {
  it('upserts an error by its fingerprint and counts repeats', async () => {
    const { db, calls } = fakeDb();
    const now = new Date('2026-10-30T22:00:00Z');
    await recordErrorReport(db, 'button s:open', 'answerCallbackQuery failed: fetch failed', true, now);

    expect(calls[0]?.table).toBe(reports);
    expect(calls[0]?.values).toEqual({
      kind: 'error',
      fingerprint: 'error:button s:open|answerCallbackQuery failed: fetch failed',
      title: 'button s:open',
      detail: 'answerCallbackQuery failed: fetch failed',
      transient: true,
      firstSeenAt: now,
      lastSeenAt: now,
    });
    expect(calls[0]?.conflict?.target).toBe(reports.fingerprint);
    expect(Object.keys(calls[0]?.conflict?.set ?? {})).toEqual(
      expect.arrayContaining(['count', 'lastSeenAt', 'status', 'issueNumber', 'digestedAt']),
    );
  });

  it('never throws into the code that reports', async () => {
    const { db } = fakeDb({ fail: true });
    await expect(recordErrorReport(db, '/x', 'y', false)).resolves.toBeUndefined();
    await expect(recordFeedbackReport(db, 'u1', 'text')).resolves.toBeUndefined();
  });

  it('keeps each feedback as its own row, tied to its author', async () => {
    const { db, calls } = fakeDb();
    await recordFeedbackReport(db, 'u1', 'one');
    await recordFeedbackReport(db, 'u1', 'one');
    const fingerprints = calls.map((c) => (c.values as { fingerprint: string }).fingerprint);
    expect(new Set(fingerprints).size).toBe(2);
    expect(calls[0]?.values).toMatchObject({ kind: 'feedback', userId: 'u1', detail: 'one' });
  });

  it('reports whether a status change took', async () => {
    expect(await setReportStatus(fakeDb({ changed: 1 }).db, 3, 'fix')).toBe(true);
    expect(await setReportStatus(fakeDb({ changed: 0 }).db, 3, 'fix')).toBe(false);
  });
});

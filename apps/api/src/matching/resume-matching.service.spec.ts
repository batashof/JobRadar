import { resumeMatches, resumes, vacancies } from '../db/schema';
import { ResumeMatchingService } from './resume-matching.service';

/**
 * Fake drizzle: a query is keyed by the table its `from()` names, so the join
 * chain can be ignored; reads come from a per-table queue and writes are
 * recorded. Everything resolves lazily so one `from()` consumes one response.
 */
function makeDb() {
  const queues = new Map<unknown, unknown[][]>();
  const writes: { table: unknown; values: unknown }[] = [];

  const chain = () => {
    let table: unknown;
    let rows: unknown[] | undefined;
    const resolve = () => (rows ??= queues.get(table)?.shift() ?? []);
    const proxy: Record<string, unknown> = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') {
            return (ok: (r: unknown[]) => unknown, err?: (e: unknown) => unknown) =>
              Promise.resolve(resolve()).then(ok, err);
          }
          return (arg: unknown) => {
            if (prop === 'from' && table === undefined) table = arg;
            return proxy;
          };
        },
      },
    );
    return proxy;
  };

  const db = {
    select: () => chain(),
    selectDistinctOn: () => chain(),
    insert: (table: unknown) => ({
      values: (values: unknown) => ({
        onConflictDoNothing: () => {
          writes.push({ table, values });
          return Promise.resolve();
        },
      }),
    }),
  };

  return {
    db: db as never,
    writes,
    queue: (table: unknown, ...responses: unknown[][]) => queues.set(table, responses),
  };
}

const REPLY = JSON.stringify({
  stack: { score: 80, note: 'React и TypeScript совпадают' },
  role: { score: 70, note: 'Та же роль' },
  summary: 'Подходит',
});

const makeLlm = (reply = REPLY) => ({
  isConfigured: () => true,
  complete: jest.fn().mockResolvedValue({ text: reply, provider: 'groq', model: 'm' }),
});

const resumeRow = (over: Record<string, unknown> = {}) => ({
  id: 'res-1',
  userId: 'user-1',
  text: 'Senior Frontend Engineer, React, TypeScript, Next.js',
  ...over,
});

const vacancyRow = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: 'Senior Frontend Engineer',
  company: 'Acme',
  description: 'React, TypeScript',
  location: 'Remote',
  ...over,
});

const service = (db: never, llm: ReturnType<typeof makeLlm>) =>
  new ResumeMatchingService(db, llm as never);

describe('ResumeMatchingService.scorePending', () => {
  it('scores an account that has no search profile at all', async () => {
    const { db, queue, writes } = makeDb();
    queue(resumes, [resumeRow()]);
    queue(vacancies, [vacancyRow('a'), vacancyRow('b')]);
    const llm = makeLlm();

    // The profile gate this query used to carry meant an account without a
    // search profile never got a single cached score — and everything ranking
    // on that score, the digest first of all, was left with no signal.
    await expect(service(db, llm).scorePending()).resolves.toMatchObject({ scored: 2 });

    expect(llm.complete).toHaveBeenCalledTimes(2);
    expect(writes).toHaveLength(2);
    expect(writes[0]).toMatchObject({ table: resumeMatches, values: { vacancyId: 'a' } });
  });

  it('writes the parsed score and breakdown, not the raw reply', async () => {
    const { db, queue, writes } = makeDb();
    queue(resumes, [resumeRow()]);
    queue(vacancies, [vacancyRow('a')]);

    await service(db, makeLlm()).scorePending();

    const values = writes[0]?.values as { score: number; explanation: string; breakdown: unknown[] };
    expect(values.score).toBeGreaterThan(0);
    expect(values.score).toBeLessThanOrEqual(1);
    expect(values.explanation).toBe('Подходит');
    expect(values.breakdown).toHaveLength(2);
  });

  it('honours the per-run cap and reports what is left', async () => {
    const { db, queue, writes } = makeDb();
    queue(resumes, [resumeRow()]);
    queue(vacancies, [vacancyRow('a'), vacancyRow('b'), vacancyRow('c')]);

    const result = await service(db, makeLlm()).scorePending(2);

    expect(writes).toHaveLength(2);
    expect(result).toMatchObject({ scored: 2, remaining: 1 });
  });

  it('does nothing without an LLM provider', async () => {
    const { db, queue, writes } = makeDb();
    queue(resumes, [resumeRow()]);
    const llm = { ...makeLlm(), isConfigured: () => false };

    await expect(service(db, llm).scorePending()).resolves.toEqual({ scored: 0, remaining: 0 });
    expect(writes).toHaveLength(0);
  });

  it('stops the run when the providers give out, leaving the rest pending', async () => {
    const { db, queue, writes } = makeDb();
    queue(resumes, [resumeRow()]);
    queue(vacancies, [vacancyRow('a'), vacancyRow('b')]);
    const llm = makeLlm();
    llm.complete
      .mockResolvedValueOnce({ text: REPLY, provider: 'groq', model: 'm' })
      .mockRejectedValueOnce(new Error('all providers failed'));

    await expect(service(db, llm).scorePending()).resolves.toMatchObject({ scored: 1 });
    expect(writes).toHaveLength(1);
  });

  it('skips an unparseable reply and keeps going', async () => {
    const { db, queue, writes } = makeDb();
    queue(resumes, [resumeRow()]);
    queue(vacancies, [vacancyRow('a'), vacancyRow('b')]);
    const llm = makeLlm();
    llm.complete
      .mockResolvedValueOnce({ text: 'sorry, I cannot', provider: 'groq', model: 'm' })
      .mockResolvedValueOnce({ text: REPLY, provider: 'groq', model: 'm' });

    await expect(service(db, llm).scorePending()).resolves.toMatchObject({ scored: 1 });
    expect(writes[0]).toMatchObject({ values: { vacancyId: 'b' } });
  });

  it('ignores a resume with no extracted text', async () => {
    const { db, queue, writes } = makeDb();
    queue(resumes, [resumeRow({ text: '' })]);
    const llm = makeLlm();

    await expect(service(db, llm).scorePending()).resolves.toEqual({ scored: 0, remaining: 0 });
    expect(llm.complete).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });
});

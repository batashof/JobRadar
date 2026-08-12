import type { ConfigService } from '@nestjs/config';

import type { BotCallbackContext } from '../bot/bot.service';
import {
  digestItems,
  digestSettings,
  hiddenVacancies,
  profileMatches,
  resumes,
  vacancies,
} from '../db/schema';
import { DigestSendService } from './digest-send.service';

/**
 * Fake drizzle: a query is keyed by the table its `from()` names, so the join
 * chain can be ignored; reads come from a per-table queue and writes are
 * recorded. Everything resolves lazily so one `from()` consumes one response.
 */
function makeDb() {
  const queues = new Map<unknown, unknown[][]>();
  const writes: { kind: string; table: unknown; values?: unknown }[] = [];

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
          writes.push({ kind: 'insert', table, values });
          return Promise.resolve();
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: () => {
          writes.push({ kind: 'update', table, values });
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

const makeBot = () => ({
  isConfigured: () => true,
  sendToUser: jest.fn().mockResolvedValue('900'),
  registerCallback: jest.fn(),
});

const makeLlm = (reply?: string) => ({
  isConfigured: () => reply !== undefined,
  complete: jest.fn().mockResolvedValue({ text: reply ?? '', provider: 'groq', model: 'm' }),
});

const config = (webOrigin = 'https://web.test') =>
  ({ get: () => webOrigin }) as unknown as ConfigService;

const settingsRow = (over: Record<string, unknown> = {}) => ({
  userId: 'user-1',
  maxItems: 10,
  minScore: 60,
  timezone: 'UTC',
  language: 'ru',
  ...over,
});

/** One row as the candidate query returns it: no rules score, that is a separate read. */
const vacancyRow = (over: Record<string, unknown> = {}) => ({
  id: 'vac-1',
  title: 'Senior Frontend Engineer',
  company: 'Acme',
  description: 'React, TypeScript',
  location: 'Remote',
  seniority: 'senior',
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  url: 'https://acme.test/1',
  publishedAt: new Date('2026-08-10T00:00:00Z'),
  resumeScore: null,
  ...over,
});

/** What `ruleScores()` reads: best profile-match score per vacancy. */
const ruleRow = (vacancyId: string, score: number) => ({ vacancyId, score });

const service = (
  db: never,
  bot: ReturnType<typeof makeBot>,
  llm: ReturnType<typeof makeLlm>,
  webOrigin?: string,
) => new DigestSendService(db, bot as never, llm as never, config(webOrigin));

describe('DigestSendService.sendNow', () => {
  it('says so plainly when there is nothing to send', async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [settingsRow()]);
    queue(vacancies, []);
    const bot = makeBot();

    await expect(service(db, bot, makeLlm()).sendNow('user-1')).resolves.toBe(0);

    expect(bot.sendToUser).toHaveBeenCalledTimes(1);
    expect(bot.sendToUser.mock.calls[0][1]).toContain('Сегодня ничего стоящего');
    expect(writes).toHaveLength(0);
  });

  it('ranks by the rules score when no LLM is configured', async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [settingsRow()]);
    queue(vacancies, [vacancyRow({ id: 'weak' }), vacancyRow({ id: 'strong' })]);
    queue(profileMatches, [ruleRow('weak', 0.3), ruleRow('strong', 0.95)]);
    queue(resumes, []);
    const bot = makeBot();
    const llm = makeLlm();

    await expect(service(db, bot, llm).sendNow('user-1')).resolves.toBe(1);

    // 0.3 → 30%, below the default floor of 60; 0.95 → 95% goes out.
    expect(llm.complete).not.toHaveBeenCalled();
    expect(writes.filter((w) => w.table === digestItems)).toHaveLength(1);
    expect(writes[0]?.values).toMatchObject({ vacancyId: 'strong', score: 95 });
  });

  it('still has candidates for a user with no search profile at all', async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [settingsRow()]);
    queue(vacancies, [vacancyRow({ id: 'a' }), vacancyRow({ id: 'b' })]);
    // No profiles → no rules scores. The feed shows these vacancies, so the
    // digest has to reach them too rather than reporting an empty day.
    queue(profileMatches, []);
    queue(resumes, [{ id: 'res-1', text: 'my resume' }]);
    const bot = makeBot();
    const llm = makeLlm('[{"i":0,"score":88,"note":"Стек совпадает"},{"i":1,"score":30}]');

    await expect(service(db, bot, llm).sendNow('user-1')).resolves.toBe(1);

    expect(llm.complete).toHaveBeenCalledTimes(1);
    expect(writes[0]?.values).toMatchObject({ vacancyId: 'a', score: 88 });
  });

  it('ranks on the cached resume score when there is no rules score', async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [settingsRow({ maxItems: 1 })]);
    queue(vacancies, [
      vacancyRow({ id: 'meh', resumeScore: 0.61 }),
      vacancyRow({ id: 'great', resumeScore: 0.92 }),
    ]);
    queue(profileMatches, []);
    queue(resumes, []);
    const bot = makeBot();

    await expect(service(db, bot, makeLlm()).sendNow('user-1')).resolves.toBe(1);
    expect(writes[0]?.values).toMatchObject({ vacancyId: 'great', score: 92 });
  });

  it('scores the batch with one LLM call and sends a card per pick', async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [settingsRow()]);
    queue(vacancies, [vacancyRow({ id: 'a' }), vacancyRow({ id: 'b' })]);
    queue(profileMatches, [ruleRow('a', 0.9), ruleRow('b', 0.2)]);
    queue(resumes, [{ id: 'res-1', text: 'my resume' }]);
    const bot = makeBot();
    const llm = makeLlm('[{"i":0,"score":91,"note":"Стек совпадает"},{"i":1,"score":40}]');

    await expect(service(db, bot, llm).sendNow('user-1')).resolves.toBe(1);

    expect(llm.complete).toHaveBeenCalledTimes(1);
    // Header + one card; the 40% vacancy is below the floor and never sent.
    expect(bot.sendToUser).toHaveBeenCalledTimes(2);
    expect(bot.sendToUser.mock.calls[1][1]).toContain('91%');
    expect(writes[0]?.values).toMatchObject({ vacancyId: 'a', score: 91 });
  });

  it('sends a long posting as several messages, with the buttons on the last', async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [settingsRow()]);
    queue(vacancies, [vacancyRow({ description: 'слово '.repeat(1000) })]);
    queue(profileMatches, [ruleRow('vac-1', 0.9)]);
    queue(resumes, []);
    const bot = makeBot();
    bot.sendToUser.mockResolvedValueOnce('900').mockResolvedValueOnce('901').mockResolvedValue('902');

    await expect(service(db, bot, makeLlm()).sendNow('user-1')).resolves.toBe(1);

    // Header + two card parts: the posting does not fit one Telegram message.
    expect(bot.sendToUser).toHaveBeenCalledTimes(3);
    expect(bot.sendToUser.mock.calls[1][2].keyboard).toBeUndefined();
    expect(bot.sendToUser.mock.calls[2][2].keyboard).toBeDefined();
    // The remembered message is the one carrying the buttons — callbacks come
    // back to edit exactly that one.
    expect(writes[0]?.values).toMatchObject({ vacancyId: 'vac-1', messageId: '902' });
  });

  it('falls back to the rules order when the LLM call fails', async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [settingsRow()]);
    queue(vacancies, [vacancyRow()]);
    queue(profileMatches, [ruleRow('vac-1', 0.8)]);
    queue(resumes, [{ id: 'res-1', text: 'my resume' }]);
    const bot = makeBot();
    const llm = makeLlm('');
    llm.complete.mockRejectedValue(new Error('all providers failed'));

    await expect(service(db, bot, llm).sendNow('user-1')).resolves.toBe(1);
    expect(writes[0]?.values).toMatchObject({ score: 80 });
  });

  it('falls back when the reply parses to nothing rather than sending an empty digest', async () => {
    const { db, queue } = makeDb();
    queue(digestSettings, [settingsRow()]);
    queue(vacancies, [vacancyRow()]);
    queue(profileMatches, [ruleRow('vac-1', 0.8)]);
    queue(resumes, [{ id: 'res-1', text: 'my resume' }]);
    const bot = makeBot();

    await expect(service(db, bot, makeLlm('sorry, I cannot')).sendNow('user-1')).resolves.toBe(1);
  });

  it('records a sent vacancy even when Telegram refused it, so it never returns', async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [settingsRow()]);
    queue(vacancies, [vacancyRow()]);
    queue(profileMatches, [ruleRow('vac-1', 0.9)]);
    queue(resumes, []);
    const bot = makeBot();
    bot.sendToUser.mockResolvedValue(null);

    await service(db, bot, makeLlm()).sendNow('user-1');

    expect(writes.filter((w) => w.table === digestItems)).toHaveLength(1);
  });

  it('respects the per-send cap', async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [settingsRow({ maxItems: 2, minScore: 0 })]);
    queue(vacancies, [
      vacancyRow({ id: 'a' }),
      vacancyRow({ id: 'b' }),
      vacancyRow({ id: 'c' }),
    ]);
    queue(profileMatches, [ruleRow('a', 0.9), ruleRow('b', 0.8), ruleRow('c', 0.7)]);
    queue(resumes, []);
    const bot = makeBot();

    await expect(service(db, bot, makeLlm()).sendNow('user-1')).resolves.toBe(2);
    expect(writes.filter((w) => w.table === digestItems)).toHaveLength(2);
  });

  it('does nothing for a user with no settings row', async () => {
    const { db, queue } = makeDb();
    queue(digestSettings, []);
    const bot = makeBot();

    await expect(service(db, bot, makeLlm()).sendNow('user-1')).resolves.toBe(0);
    expect(bot.sendToUser).not.toHaveBeenCalled();
  });
});

describe('DigestSendService.run', () => {
  const scheduled = (over: Record<string, unknown> = {}) => ({
    userId: 'user-1',
    enabled: true,
    sendTimes: ['09:00'],
    maxItems: 10,
    minScore: 60,
    lastSentKey: null,
    timezone: 'UTC',
    language: 'ru',
    ...over,
  });

  it('does nothing before a slot comes round', async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [scheduled()]);
    const bot = makeBot();

    await expect(
      service(db, bot, makeLlm()).run(new Date('2026-08-11T08:00:00Z')),
    ).resolves.toMatchObject({ sent: 0, skipped: 0 });
    expect(bot.sendToUser).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it('sends the due slot and consumes it exactly once', async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [scheduled()]);
    queue(vacancies, []);
    const bot = makeBot();

    const result = await service(db, bot, makeLlm()).run(new Date('2026-08-11T09:01:00Z'));

    expect(result).toMatchObject({ users: 1, sent: 1 });
    expect(writes.find((w) => w.table === digestSettings)?.values).toMatchObject({
      lastSentKey: '2026-08-11 09:00',
    });
  });

  it('consumes a long-elapsed slot without sending a morning digest at night', async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [scheduled()]);
    const bot = makeBot();

    const result = await service(db, bot, makeLlm()).run(new Date('2026-08-11T22:00:00Z'));

    expect(result).toMatchObject({ sent: 0, skipped: 1 });
    expect(bot.sendToUser).not.toHaveBeenCalled();
    expect(writes[0]?.values).toMatchObject({ lastSentKey: '2026-08-11 09:00' });
  });

  it('keeps going when one user run throws', async () => {
    const { db, queue } = makeDb();
    queue(digestSettings, [scheduled({ userId: 'bad' }), scheduled({ userId: 'good' })]);
    // Only one candidate response is queued, so the second user reads an empty
    // list — the point is that the loop reaches them at all.
    queue(vacancies, []);
    const bot = makeBot();
    bot.sendToUser.mockRejectedValueOnce(new Error('boom'));

    const result = await service(db, bot, makeLlm()).run(new Date('2026-08-11T09:01:00Z'));

    expect(result.users).toBe(2);
    expect(result.sent).toBe(1);
  });
});

describe('DigestSendService buttons', () => {
  const ctx = (parts: string[]): BotCallbackContext => ({
    userId: 'user-1',
    chatId: '555',
    messageId: 77,
    parts,
    language: 'ru',
  });

  const handlerFor = (db: never, bot: ReturnType<typeof makeBot>) => {
    const instance = service(db, bot, makeLlm());
    instance.onModuleInit();
    return bot.registerCallback.mock.calls[0][1] as (
      c: BotCallbackContext,
    ) => Promise<{ alert?: string; editKeyboard?: unknown }>;
  };

  it('registers under the digest namespace', () => {
    const { db } = makeDb();
    const bot = makeBot();
    handlerFor(db, bot);
    expect(bot.registerCallback).toHaveBeenCalledWith('d', expect.any(Function));
  });

  it('hides a vacancy and rewrites its card', async () => {
    const { db, writes } = makeDb();
    const bot = makeBot();
    const result = await handlerFor(db, bot)(ctx(['d', 'h', 'vac-1']));

    expect(writes[0]).toMatchObject({
      kind: 'insert',
      table: hiddenVacancies,
      values: { userId: 'user-1', vacancyId: 'vac-1' },
    });
    expect(result.editKeyboard).toBeNull();
  });

  it('records both thumbs against the digest item', async () => {
    const { db, writes } = makeDb();
    const bot = makeBot();
    const handler = handlerFor(db, bot);

    await handler(ctx(['d', 'u', 'vac-1']));
    await handler(ctx(['d', 'w', 'vac-2']));

    expect(writes[0]).toMatchObject({ table: digestItems, values: { feedback: 1 } });
    expect(writes[1]).toMatchObject({ table: digestItems, values: { feedback: -1 } });
  });

  it('ignores malformed callback data', async () => {
    const { db, writes } = makeDb();
    const bot = makeBot();
    await handlerFor(db, bot)(ctx(['d']));
    expect(writes).toHaveLength(0);
  });
});

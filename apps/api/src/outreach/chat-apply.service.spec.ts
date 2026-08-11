import type { ConfigService } from '@nestjs/config';

import type { BotCallbackContext, BotCallbackHandler } from '../bot/bot.service';
import { applyDrafts, vacancies } from '../db/schema';
import { ChatApplyService } from './chat-apply.service';

/** Same shape as the digest fake: reads keyed by table, writes recorded. */
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
        get(_t, prop) {
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
    insert: (table: unknown) => ({
      values: (values: unknown) => ({
        returning: () => {
          writes.push({ kind: 'insert', table, values });
          return Promise.resolve(queues.get(table)?.shift() ?? [{ id: 'draft-1' }]);
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => {
        const done = {
          where: () => ({
            returning: () => {
              writes.push({ kind: 'update', table, values });
              return Promise.resolve(queues.get(table)?.shift() ?? [{ id: 'draft-1' }]);
            },
            then: (ok: (r: unknown) => unknown) => {
              writes.push({ kind: 'update', table, values });
              return Promise.resolve(undefined).then(ok);
            },
          }),
        };
        return done;
      },
    }),
    delete: (table: unknown) => ({
      where: () => {
        writes.push({ kind: 'delete', table });
        return Promise.resolve();
      },
    }),
  };

  return {
    db: db as never,
    writes,
    queue: (table: unknown, ...responses: unknown[][]) => queues.set(table, responses),
  };
}

const makeBot = () => ({ sendToUser: jest.fn().mockResolvedValue('1'), registerCallback: jest.fn() });
const makeOutreach = () => ({
  coverLetter: jest.fn().mockResolvedValue({ coverLetter: 'Здравствуйте!' }),
  draftApplyEmail: jest
    .fn()
    .mockResolvedValue({ recipient: 'hr@acme.test', subject: 'Subj', body: 'Body' }),
  sendApplyEmail: jest.fn().mockResolvedValue({ outreachId: 'o1' }),
});
const makeGmail = (connected = true) => ({ statusFor: jest.fn().mockResolvedValue({ connected }) });

const ctx = (parts: string[]): BotCallbackContext => ({
  userId: 'user-1',
  chatId: '555',
  messageId: 7,
  parts,
  language: 'ru',
});

function build(
  db: never,
  bot: ReturnType<typeof makeBot>,
  outreach: ReturnType<typeof makeOutreach>,
  gmail: ReturnType<typeof makeGmail>,
) {
  const service = new ChatApplyService(
    db,
    bot as never,
    outreach as never,
    gmail as never,
    { get: () => 'https://web.test' } as unknown as ConfigService,
  );
  service.onModuleInit();
  return bot.registerCallback.mock.calls[0][1] as BotCallbackHandler;
}

/** The draft path is fire-and-forget; let its microtasks run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ChatApplyService — drafting', () => {
  it('registers under the apply namespace, not the digest one', () => {
    const { db } = makeDb();
    const bot = makeBot();
    build(db, bot, makeOutreach(), makeGmail());
    expect(bot.registerCallback).toHaveBeenCalledWith('a', expect.any(Function));
  });

  it('answers the press immediately and delivers the draft after', async () => {
    const { db, queue, writes } = makeDb();
    queue(vacancies, [
      { title: 'Senior Frontend', url: 'https://acme.test/1', contact: { kind: 'email', value: 'hr@acme.test' } },
    ]);
    const bot = makeBot();
    const outreach = makeOutreach();

    // Drafting is an LLM call — it must not hold Telegram's callback window.
    const result = await build(db, bot, outreach, makeGmail())(ctx(['a', 'd', 'vac-1']));
    expect(result).toEqual({ alert: 'Готовлю отклик…' });

    await settle();
    expect(outreach.coverLetter).toHaveBeenCalledWith('user-1', 'vac-1');
    expect(writes.find((w) => w.table === applyDrafts)?.values).toMatchObject({
      recipient: 'hr@acme.test',
      subject: 'Subj',
    });
    const [, text, options] = bot.sendToUser.mock.calls[0];
    expect(text).toContain('hr@acme.test');
    expect(options.keyboard[0][0].callbackData).toBe('a:s:draft-1');
  });

  it('asks for Gmail instead of drafting an email it cannot send', async () => {
    const { db, queue, writes } = makeDb();
    queue(vacancies, [
      { title: 'T', url: 'https://acme.test/1', contact: { kind: 'email', value: 'hr@acme.test' } },
    ]);
    const bot = makeBot();
    const outreach = makeOutreach();

    await build(db, bot, outreach, makeGmail(false))(ctx(['a', 'd', 'vac-1']));
    await settle();

    expect(outreach.draftApplyEmail).not.toHaveBeenCalled();
    expect(writes.filter((w) => w.table === applyDrafts)).toHaveLength(0);
    expect(bot.sendToUser.mock.calls[0][1]).toContain('Подключи Gmail');
  });

  it('hands a Telegram contact a copyable letter and a link to the chat', async () => {
    const { db, queue } = makeDb();
    queue(vacancies, [
      { title: 'T', url: 'https://acme.test/1', contact: { kind: 'telegram', value: '@hr_acme' } },
    ]);
    const bot = makeBot();

    await build(db, bot, makeOutreach(), makeGmail())(ctx(['a', 'd', 'vac-1']));
    await settle();

    const [, text, options] = bot.sendToUser.mock.calls[0];
    expect(text).toContain('@hr_acme');
    expect(text).toContain('<pre>Здравствуйте!</pre>');
    expect(options.keyboard).toEqual([[{ text: 'Открыть чат', url: 'https://t.me/hr_acme' }]]);
  });

  it('omits the chat button when the scraped handle is unusable', async () => {
    const { db, queue } = makeDb();
    queue(vacancies, [
      { title: 'T', url: 'https://acme.test/1', contact: { kind: 'telegram', value: 'пишите сюда' } },
    ]);
    const bot = makeBot();

    await build(db, bot, makeOutreach(), makeGmail())(ctx(['a', 'd', 'vac-1']));
    await settle();

    expect(bot.sendToUser.mock.calls[0][2].keyboard).toBeUndefined();
  });

  it('falls back to the letter plus links when there is no contact at all', async () => {
    const { db, queue } = makeDb();
    queue(vacancies, [{ title: 'T', url: 'https://acme.test/1', contact: null }]);
    const bot = makeBot();

    await build(db, bot, makeOutreach(), makeGmail())(ctx(['a', 'd', 'vac-1']));
    await settle();

    const [, text, options] = bot.sendToUser.mock.calls[0];
    expect(text).toContain('<pre>Здравствуйте!</pre>');
    expect(options.keyboard[0]).toEqual([
      { text: 'Открыть в приложении', url: 'https://web.test/app/vacancies/vac-1' },
      { text: 'Открыть вакансию', url: 'https://acme.test/1' },
    ]);
  });

  it('tells the user when preparing blew up instead of going silent', async () => {
    const { db, queue } = makeDb();
    queue(vacancies, [{ title: 'T', url: 'u', contact: null }]);
    const bot = makeBot();
    const outreach = makeOutreach();
    outreach.coverLetter.mockRejectedValue(new Error('llm down'));

    await build(db, bot, outreach, makeGmail())(ctx(['a', 'd', 'vac-1']));
    await settle();

    expect(bot.sendToUser.mock.calls[0][1]).toContain('Не удалось подготовить отклик');
  });

  it('ignores an unknown vacancy', async () => {
    const { db, queue } = makeDb();
    queue(vacancies, []);
    const bot = makeBot();

    await build(db, bot, makeOutreach(), makeGmail())(ctx(['a', 'd', 'nope']));
    await settle();

    expect(bot.sendToUser).not.toHaveBeenCalled();
  });
});

describe('ChatApplyService — confirming', () => {
  const draftRow = (over: Record<string, unknown> = {}) => ({
    id: 'draft-1',
    userId: 'user-1',
    vacancyId: 'vac-1',
    recipient: 'hr@acme.test',
    subject: 'Subj',
    body: 'Body',
    sentAt: null,
    ...over,
  });

  it('sends through the app path, so outreach and the board are updated too', async () => {
    const { db, queue } = makeDb();
    queue(applyDrafts, [draftRow()], [{ id: 'draft-1' }]);
    const bot = makeBot();
    const outreach = makeOutreach();

    const result = await build(db, bot, outreach, makeGmail())(ctx(['a', 's', 'draft-1']));

    expect(outreach.sendApplyEmail).toHaveBeenCalledWith('user-1', 'vac-1', {
      recipient: 'hr@acme.test',
      subject: 'Subj',
      body: 'Body',
    });
    expect(result).toMatchObject({ editKeyboard: null });
    expect(result?.alert).toContain('Отправлено');
  });

  it('refuses a draft that was already sent', async () => {
    const { db, queue } = makeDb();
    queue(applyDrafts, [draftRow({ sentAt: new Date() })]);
    const bot = makeBot();
    const outreach = makeOutreach();

    const result = await build(db, bot, outreach, makeGmail())(ctx(['a', 's', 'draft-1']));

    expect(outreach.sendApplyEmail).not.toHaveBeenCalled();
    expect(result?.alert).toContain('Уже отправлено');
  });

  it('does not send twice when two taps race', async () => {
    const { db, queue } = makeDb();
    // The row still looked unsent, but claiming it updated nothing.
    queue(applyDrafts, [draftRow()], []);
    const bot = makeBot();
    const outreach = makeOutreach();

    const result = await build(db, bot, outreach, makeGmail())(ctx(['a', 's', 'draft-1']));

    expect(outreach.sendApplyEmail).not.toHaveBeenCalled();
    expect(result?.alert).toContain('Уже отправлено');
  });

  it('releases the claim when sending fails, so a retry is possible', async () => {
    const { db, queue, writes } = makeDb();
    queue(applyDrafts, [draftRow()], [{ id: 'draft-1' }]);
    const bot = makeBot();
    const outreach = makeOutreach();
    outreach.sendApplyEmail.mockRejectedValue(new Error('gmail 401'));

    const result = await build(db, bot, outreach, makeGmail())(ctx(['a', 's', 'draft-1']));

    expect(result?.alert).toContain('Не удалось отправить');
    expect(writes.filter((w) => w.kind === 'update').at(-1)?.values).toMatchObject({
      sentAt: null,
    });
  });

  it('reports a draft that no longer exists', async () => {
    const { db, queue } = makeDb();
    queue(applyDrafts, []);
    const bot = makeBot();

    const result = await build(db, bot, makeOutreach(), makeGmail())(ctx(['a', 's', 'gone']));
    expect(result?.alert).toContain('Черновик потерялся');
  });

  it('cancel deletes the draft and clears the buttons', async () => {
    const { db, writes } = makeDb();
    const bot = makeBot();

    const result = await build(db, bot, makeOutreach(), makeGmail())(ctx(['a', 'x', 'draft-1']));

    expect(writes).toContainEqual({ kind: 'delete', table: applyDrafts });
    expect(result).toMatchObject({ editKeyboard: null });
    expect(result?.alert).toContain('Отменено');
  });

  it('ignores malformed callback data', async () => {
    const { db, writes } = makeDb();
    const bot = makeBot();
    await build(db, bot, makeOutreach(), makeGmail())(ctx(['a']));
    expect(writes).toHaveLength(0);
  });
});

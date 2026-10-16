import type { BotCallbackContext, BotMessageContext } from '../bot/bot.service';
import { digestSettings, events, plannerSettings, sources, users } from '../db/schema';
import { SettingsBotService } from './settings-bot.service';

/** Fake drizzle: reads are queued per table; writes are recorded. */
function makeDb() {
  const queues = new Map<unknown, unknown[][]>();
  const writes: { kind: string; table: unknown; values?: unknown; set?: unknown }[] = [];

  const chain = () => {
    let table: unknown;
    const proxy: Record<string, unknown> = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') {
            return (ok: (r: unknown[]) => unknown) =>
              Promise.resolve(queues.get(table)?.shift() ?? []).then(ok);
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
        onConflictDoUpdate: ({ set }: { set: unknown }) => {
          writes.push({ kind: 'upsert', table, values, set });
          return Promise.resolve();
        },
        then: (ok: (v: unknown) => unknown) => {
          writes.push({ kind: 'insert', table, values });
          return Promise.resolve(undefined).then(ok);
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (set: unknown) => ({
        where: () => {
          writes.push({ kind: 'update', table, set });
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

const digestRow = {
  userId: 'user-1',
  enabled: true,
  mode: 'instant',
  sendTimes: ['09:00'],
  quietStart: '22:00',
  quietEnd: '08:00',
  minScore: 60,
  instantMinScore: 75,
  maxItems: null,
  workFormats: [],
  employmentTypes: [],
  minSalaryUsd: null,
  mutedSources: [],
};

function setup() {
  const { db, writes, queue } = makeDb();
  const bot = {
    registerCommand: jest.fn(),
    registerCallback: jest.fn(),
    registerDialog: jest.fn(),
    sendToUser: jest.fn().mockResolvedValue('1'),
  };
  const dialogs = { open: jest.fn(), close: jest.fn() };
  const service = new SettingsBotService(db, bot as never, dialogs as never);
  service.onModuleInit();
  const command = bot.registerCommand.mock.calls[0][1] as (c: BotMessageContext) => Promise<void>;
  const callback = bot.registerCallback.mock.calls[0][1] as (
    c: BotCallbackContext,
  ) => Promise<{ editText?: string; editKeyboard?: unknown }>;
  const typed = bot.registerDialog.mock.calls[0][1] as (
    c: BotMessageContext,
    text: string,
    dialog: { step: string },
  ) => Promise<void>;
  return { service, bot, dialogs, writes, queue, command, callback, typed };
}

const msg: BotMessageContext = { userId: 'user-1', chatId: '555', language: 'ru', role: 'user' };
const press = (parts: string[]): BotCallbackContext => ({ ...msg, messageId: 9, parts });

describe('SettingsBotService', () => {
  it('registers /settings, its buttons and its typed answers', () => {
    const { bot } = setup();
    expect(bot.registerCommand).toHaveBeenCalledWith('settings', expect.any(Function));
    expect(bot.registerCallback).toHaveBeenCalledWith('s', expect.any(Function));
    expect(bot.registerDialog).toHaveBeenCalledWith('settings', expect.any(Function));
  });

  it('shows the menu, with defaults for an account that has no rows', async () => {
    const { command, bot, queue } = setup();
    queue(sources, [{ slug: 'hh' }]);

    await command(msg);

    const [userId, text, options] = bot.sendToUser.mock.calls[0];
    expect(userId).toBe('user-1');
    expect(text).toContain('Часовой пояс: Europe/Moscow');
    expect(text).toContain('Доставка: в 09:00');
    expect(options.keyboard.length).toBeGreaterThan(0);
  });

  it("lists only the sources a user receives: the owner's own stay hidden", async () => {
    const rows = [
      { slug: 'dou', config: {} },
      { slug: 'linkedin', config: { ownerOnly: true } },
    ];
    const buttons = async (role: BotCallbackContext['role']) => {
      const { callback, queue } = setup();
      queue(digestSettings, [digestRow]);
      queue(plannerSettings, [{ timezone: 'Europe/Minsk' }]);
      queue(sources, rows);
      const result = await callback({ ...press(['s', 'open', 'src']), role });
      return JSON.stringify(result.editKeyboard);
    };

    const user = await buttons('user');
    expect(user).toContain('s:src:dou');
    expect(user).not.toContain('s:src:linkedin');
    expect(await buttons('owner')).toContain('s:src:linkedin');
  });

  it('lists LinkedIn for a user with a personal forwarding address (ADR-027)', async () => {
    const { callback, queue } = setup();
    queue(digestSettings, [digestRow]);
    queue(plannerSettings, [{ timezone: 'Europe/Minsk' }]);
    queue(sources, [
      { slug: 'dou', config: {} },
      { slug: 'linkedin', config: { ownerOnly: true } },
      { slug: 'private', config: { ownerOnly: true } },
    ]);
    queue(users, [{ token: 'abcdefghijkl' }]);

    const result = await callback({ ...press(['s', 'open', 'src']), role: 'user' });

    const keyboard = JSON.stringify(result.editKeyboard);
    expect(keyboard).toContain('s:src:linkedin');
    expect(keyboard).toContain('s:src:dou');
    expect(keyboard).not.toContain('s:src:private');
  });

  it('saves a button press and rewrites the menu in place', async () => {
    const { callback, writes, queue, dialogs } = setup();
    queue(digestSettings, [digestRow]);
    queue(plannerSettings, [{ timezone: 'Europe/Minsk' }]);
    queue(sources, [{ slug: 'hh' }]);

    const result = await callback(press(['s', 'mode']));

    expect(writes[0]).toMatchObject({
      kind: 'upsert',
      table: digestSettings,
      set: { mode: 'scheduled' },
    });
    expect(writes.find((w) => w.table === events)?.values).toMatchObject({
      name: 'settings_changed',
      props: { keys: 'mode' },
    });
    expect(result.editText).toContain('Доставка: в 09:00');
    expect(dialogs.close).toHaveBeenCalledWith('555');
  });

  it('writes timezone and language where they live', async () => {
    const { service, writes } = setup();
    await service.save('user-1', { timezone: 'Asia/Tbilisi', language: 'en' });
    expect(writes[0]).toMatchObject({ table: plannerSettings, set: { timezone: 'Asia/Tbilisi' } });
    expect(writes[1]).toMatchObject({ kind: 'update', table: users, set: { language: 'en' } });
    expect(writes.some((w) => w.table === digestSettings)).toBe(false);
  });

  it('opens a dialog for a typed value', async () => {
    const { callback, queue, dialogs } = setup();
    queue(digestSettings, [digestRow]);

    const result = await callback(press(['s', 'type', 'tz']));

    expect(dialogs.open).toHaveBeenCalledWith('555', expect.objectContaining({ flow: 'settings', step: 'tz' }));
    expect(result.editText).toContain('Europe/Lisbon');
  });

  it('saves a typed answer and sends a fresh menu', async () => {
    const { typed, writes, bot, dialogs, queue } = setup();
    queue(digestSettings, [digestRow]);
    queue(plannerSettings, [{ timezone: 'Europe/Lisbon' }]);

    await typed(msg, 'Europe/Lisbon', { step: 'tz' });

    expect(writes[0]).toMatchObject({ table: plannerSettings, set: { timezone: 'Europe/Lisbon' } });
    expect(dialogs.close).toHaveBeenCalledWith('555');
    expect(bot.sendToUser.mock.calls[0][1]).toContain('Сохранено.');
  });

  it('keeps the dialog open on an answer it cannot read', async () => {
    const { typed, writes, bot, dialogs } = setup();

    await typed(msg, 'somewhere nice', { step: 'tz' });

    expect(writes).toHaveLength(0);
    expect(dialogs.close).not.toHaveBeenCalled();
    expect(bot.sendToUser.mock.calls[0][1]).toContain('Не понял');
  });
});

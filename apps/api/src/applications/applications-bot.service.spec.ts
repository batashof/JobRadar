import type { ApplicationItem } from '@jobradar/shared';

import type { BotCallbackContext, BotCallbackResult, BotMessageContext } from '../bot/bot.service';
import { ApplicationsBotService } from './applications-bot.service';

const ID = '11111111-2222-4333-8444-555555555555';

function item(over: Partial<ApplicationItem> = {}): ApplicationItem {
  return {
    id: ID,
    stage: 'applied',
    stageOrder: 0,
    notes: '',
    appliedAt: '2026-10-10T09:00:00Z',
    lastActivityAt: new Date().toISOString(),
    remindAfterDays: null,
    createdAt: '2026-10-10T09:00:00Z',
    vacancy: {
      id: 'vac-1',
      title: 'Node.js Developer',
      company: 'Acme',
      url: 'https://acme.test/1',
      source: 'djinni',
    },
    ...over,
  };
}

/** Fake drizzle for the one read the service makes: the user's timezone. */
function makeDb(timezone: string | null) {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(timezone ? [{ timezone }] : []),
      }),
    }),
  } as never;
}

function setup(timezone: string | null = 'Europe/Moscow') {
  const bot = {
    registerCommand: jest.fn(),
    registerCallback: jest.fn(),
    sendToUser: jest.fn().mockResolvedValue('1'),
  };
  const applications = {
    get: jest.fn().mockResolvedValue(item()),
    listRecent: jest.fn().mockResolvedValue([item()]),
    stats: jest.fn().mockResolvedValue({ total: 1, byStage: { applied: 1 }, funnel: [] }),
    update: jest.fn(),
    remove: jest.fn().mockResolvedValue(undefined),
    snooze: jest.fn(),
  };
  const service = new ApplicationsBotService(makeDb(timezone), bot as never, applications as never);
  service.onModuleInit();
  const command = bot.registerCommand.mock.calls[0][1] as (
    c: BotMessageContext,
    arg: string,
  ) => Promise<void>;
  const callback = bot.registerCallback.mock.calls[0][1] as (
    c: BotCallbackContext,
  ) => Promise<BotCallbackResult>;
  return { bot, applications, command, callback };
}

const msg: BotMessageContext = { userId: 'user-1', chatId: '555', language: 'en', role: 'user' };
const press = (...parts: string[]): BotCallbackContext => ({ ...msg, messageId: 9, parts });

describe('ApplicationsBotService', () => {
  it('registers /applications and the j namespace, for every role', () => {
    const { bot } = setup();
    expect(bot.registerCommand).toHaveBeenCalledWith('applications', expect.any(Function));
    expect(bot.registerCallback).toHaveBeenCalledWith('j', expect.any(Function));
  });

  it('sends the active list for /applications', async () => {
    const { command, bot, applications } = setup();
    await command(msg, '');

    expect(applications.listRecent).toHaveBeenCalledWith('user-1', false, 10);
    const [userId, text, options] = bot.sendToUser.mock.calls[0];
    expect(userId).toBe('user-1');
    expect(text).toContain('📋 Your applications');
    expect(text).toContain('1. <b>Node.js Developer</b> — Acme');
    expect(options).toMatchObject({ parseMode: 'HTML' });
    expect(options.keyboard[0][0].callbackData).toBe(`j:o:${ID}`);
  });

  it('switches to the archive and back in place', async () => {
    const { callback, applications } = setup();
    applications.listRecent.mockResolvedValueOnce([item({ stage: 'rejected' })]);
    applications.stats.mockResolvedValue({ total: 2, byStage: { applied: 1, rejected: 1 } });

    const archive = await callback(press('j', 'a'));
    expect(applications.listRecent).toHaveBeenLastCalledWith('user-1', true, 10);
    expect(archive.editText).toContain('🗄 Archive');
    expect(archive.editKeyboard?.at(-1)).toEqual([{ text: '⬅️ Back', callbackData: 'j:l' }]);

    const list = await callback(press('j', 'l'));
    expect(applications.listRecent).toHaveBeenLastCalledWith('user-1', false, 10);
    expect(list.editText).toContain('📋 Your applications');
  });

  it('opens a card, with the date in the user timezone', async () => {
    const { callback, applications } = setup('Asia/Tokyo');
    applications.get.mockResolvedValue(item({ appliedAt: '2026-10-10T20:00:00Z' }));

    const result = await callback(press('j', 'o', ID));

    expect(applications.get).toHaveBeenCalledWith('user-1', ID);
    expect(result.editText).toContain('Stage: 📨 Applied');
    // 20:00 UTC on the 10th is already the 11th in Tokyo.
    expect(result.editText).toContain('Applied: 11 Oct 2026');
  });

  it('moves the stage through ApplicationsService and re-renders the card', async () => {
    const { callback, applications } = setup();
    applications.update.mockResolvedValue(item({ stage: 'tech_interview' }));

    const result = await callback(press('j', 's', ID, 'i'));

    expect(applications.update).toHaveBeenCalledWith('user-1', ID, { stage: 'tech_interview' });
    expect(result.alert).toBe('Moved: 💻 Interview');
    expect(result.editText).toContain('Stage: 💻 Interview');
    const texts = result.editKeyboard!.flat().map((b) => b.text);
    expect(texts).not.toContain('💻 Interview');
    expect(texts).toContain('📨 Applied');
  });

  it('asks before deleting, then deletes and returns to the list', async () => {
    const { callback, applications } = setup();

    const ask = await callback(press('j', 'd', ID));
    expect(ask.editText).toContain('Delete this application?');
    expect(applications.remove).not.toHaveBeenCalled();

    const done = await callback(press('j', 'x', ID));
    expect(applications.remove).toHaveBeenCalledWith('user-1', ID);
    expect(done.alert).toBe('Deleted.');
    expect(done.editText).toContain('📋 Your applications');
  });

  it('returns to the archive after deleting a closed application', async () => {
    const { callback, applications } = setup();
    applications.get.mockResolvedValue(item({ stage: 'withdrawn' }));
    await callback(press('j', 'x', ID));
    expect(applications.listRecent).toHaveBeenLastCalledWith('user-1', true, 10);
  });

  it('snoozes a reminder: the clock restarts and the buttons go', async () => {
    const { callback, applications } = setup();
    applications.snooze.mockResolvedValue(item({ remindAfterDays: null }));

    const result = await callback(press('j', 'z', ID));

    expect(applications.snooze).toHaveBeenCalledWith('user-1', ID);
    expect(result.alert).toBe('⏳ Got it: I will remind you again in 7 days.');
    expect(result.editText).toContain('<b>Node.js Developer</b> — Acme');
    expect(result.editKeyboard).toBeNull();
  });

  it('says an application is gone and shows the list instead', async () => {
    const { callback, applications } = setup();
    applications.get.mockResolvedValue(null);

    const result = await callback(press('j', 's', ID, 'o'));

    expect(applications.update).not.toHaveBeenCalled();
    expect(result.alert).toBe('This application is gone.');
    expect(result.editText).toContain('📋 Your applications');
  });

  it('ignores malformed data without touching anything', async () => {
    const { callback, applications } = setup();
    expect(await callback(press('j', 'o', 'nope'))).toEqual({});
    expect(applications.get).not.toHaveBeenCalled();
  });

  it('falls back to the default timezone without a planner row', async () => {
    const { callback } = setup(null);
    const result = await callback(press('j', 'o', ID));
    expect(result.editText).toContain('Applied: 10 Oct 2026');
  });
});

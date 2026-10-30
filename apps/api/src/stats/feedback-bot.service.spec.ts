import type { BotMessageContext } from '../bot/bot.service';
import { events, reports } from '../db/schema';
import { FEEDBACK_FLOW, FEEDBACK_MAX, FeedbackBotService } from './feedback-bot.service';

const ctx: BotMessageContext = { userId: 'u1', chatId: '555', language: 'ru', role: 'user' };

function setup(username: string | null = 'anna') {
  const inserts: { table: unknown; values: Record<string, unknown> }[] = [];
  const db = {
    select: () => ({ from: () => ({ where: () => Promise.resolve(username ? [{ username }] : []) }) }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserts.push({ table, values });
        return Promise.resolve();
      },
    }),
  };
  const bot = {
    registerCommand: jest.fn(),
    registerDialog: jest.fn(),
    sendToUser: jest.fn().mockResolvedValue('1'),
    notifyOwners: jest.fn().mockResolvedValue(undefined),
  };
  const dialogs = { open: jest.fn(), close: jest.fn() };
  const service = new FeedbackBotService(db as never, bot as never, dialogs as never);
  /** What the owner reads, rendered in their language. */
  const toOwner = (lang: 'ru' | 'en' = 'ru') =>
    (bot.notifyOwners.mock.calls[0][0] as (l: 'ru' | 'en') => string)(lang);
  return { service, bot, dialogs, inserts, toOwner };
}

describe('FeedbackBotService', () => {
  it('registers /feedback and its dialog', () => {
    const { service, bot } = setup();
    service.onModuleInit();
    expect(bot.registerCommand).toHaveBeenCalledWith('feedback', expect.any(Function));
    expect(bot.registerDialog).toHaveBeenCalledWith(FEEDBACK_FLOW, expect.any(Function));
  });

  it('forwards "/feedback text" to the owner at once and thanks the user', async () => {
    const { service, bot, inserts, toOwner, dialogs } = setup();
    await service.command(ctx, 'фильтр по локации не работает');

    expect(toOwner()).toBe('💬 Отзыв от @anna (ru)\n\nфильтр по локации не работает');
    expect(bot.sendToUser).toHaveBeenCalledWith('u1', 'Спасибо! Передал автору.');
    expect(dialogs.open).not.toHaveBeenCalled();
    // The event keeps only the fact and the length; the text goes to the
    // triage inbox (ADR-036), tied to the account so /delete removes it.
    expect(inserts[0]).toEqual({
      table: events,
      values: { userId: 'u1', name: 'feedback', props: { length: 29 } },
    });
    expect(inserts[1]).toEqual({
      table: reports,
      values: {
        kind: 'feedback',
        fingerprint: expect.stringMatching(/^feedback:[\w-]{36}$/),
        title: 'фильтр по локации не работает',
        detail: 'фильтр по локации не работает',
        userId: 'u1',
      },
    });
  });

  it('asks for the text on a bare /feedback, then forwards the answer', async () => {
    const { service, bot, dialogs, toOwner } = setup(null);
    await service.command(ctx, '  ');
    expect(dialogs.open).toHaveBeenCalledWith('555', { userId: 'u1', flow: FEEDBACK_FLOW, step: 'text', payload: {} });
    expect(bot.sendToUser.mock.calls[0][1]).toContain('Напиши одним сообщением');

    await service.answer(ctx, 'нет вакансий по Go');
    expect(dialogs.close).toHaveBeenCalledWith('555');
    // No username: the account id is what the owner can look up.
    expect(toOwner('en')).toBe('💬 Feedback from u1 (ru)\n\nнет вакансий по Go');
  });

  it('cuts a very long text', async () => {
    const { service, toOwner } = setup();
    await service.command(ctx, 'x'.repeat(FEEDBACK_MAX + 500));
    expect(toOwner().endsWith('x'.repeat(FEEDBACK_MAX))).toBe(true);
    expect(toOwner()).not.toContain('x'.repeat(FEEDBACK_MAX + 1));
  });
});

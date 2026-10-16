import { ApplicationRemindersService } from './application-reminders.service';
import type { ReminderCandidate } from './reminder-logic';

// 12:00 UTC: daytime in Moscow, early morning in New York.
const NOW = new Date('2026-10-16T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

function candidate(over: Partial<ReminderCandidate> = {}): ReminderCandidate {
  return {
    id: 'app-1',
    userId: 'user-1',
    stage: 'applied',
    lastActivityAt: daysAgo(9),
    remindAfterDays: null,
    remindedAt: null,
    title: 'Node.js Developer',
    company: 'Acme',
    timezone: 'Europe/Moscow',
    language: 'en',
    ...over,
  };
}

function setup(candidates: ReminderCandidate[], configured = true) {
  const applications = {
    listReminderCandidates: jest.fn().mockResolvedValue(candidates),
    markReminded: jest.fn().mockResolvedValue(undefined),
  };
  const bot = {
    isConfigured: jest.fn().mockReturnValue(configured),
    sendToUser: jest.fn().mockResolvedValue('42'),
  };
  const service = new ApplicationRemindersService(applications as never, bot as never);
  return { service, applications, bot };
}

describe('ApplicationRemindersService', () => {
  it('sends one reminder per due application and stamps it', async () => {
    const { service, applications, bot } = setup([
      candidate(),
      candidate({ id: 'app-2', userId: 'user-2', timezone: 'America/New_York' }),
      candidate({ id: 'app-3', remindedAt: daysAgo(1) }),
    ]);

    const result = await service.run(NOW);

    expect(result).toEqual({ candidates: 3, sent: 1, failed: 0 });
    expect(bot.sendToUser).toHaveBeenCalledTimes(1);
    const [userId, text, options] = bot.sendToUser.mock.calls[0];
    expect(userId).toBe('user-1');
    expect(text).toBe(
      '⏰ No answer from <b>Acme</b> for 9 days: Node.js Developer. Did anything change?',
    );
    expect(options.parseMode).toBe('HTML');
    const buttons = options.keyboard.flat();
    expect(buttons.at(-1)).toEqual({ text: '⏳ Remind in 7 days', callbackData: 'j:z:app-1' });
    expect(applications.markReminded).toHaveBeenCalledWith('app-1', NOW);
  });

  it('leaves an undelivered reminder unstamped, to retry next sweep', async () => {
    const { service, applications, bot } = setup([candidate()]);
    bot.sendToUser.mockResolvedValue(null);

    const result = await service.run(NOW);

    expect(result).toEqual({ candidates: 1, sent: 0, failed: 1 });
    expect(applications.markReminded).not.toHaveBeenCalled();
  });

  it('keeps going when one user fails', async () => {
    const { service, applications, bot } = setup([
      candidate({ id: 'bad', userId: 'user-bad', lastActivityAt: daysAgo(20) }),
      candidate({ id: 'good', userId: 'user-good' }),
    ]);
    bot.sendToUser.mockRejectedValueOnce(new Error('boom'));

    const result = await service.run(NOW);

    expect(result).toEqual({ candidates: 2, sent: 1, failed: 1 });
    expect(applications.markReminded).toHaveBeenCalledWith('good', NOW);
  });

  it('does nothing while the bot is off', async () => {
    const { service, applications } = setup([candidate()], false);
    expect(await service.run(NOW)).toEqual({ candidates: 0, sent: 0, failed: 0 });
    expect(applications.listReminderCandidates).not.toHaveBeenCalled();
  });
});

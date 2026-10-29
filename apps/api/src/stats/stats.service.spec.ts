import type { BotMessageContext } from '../bot/bot.service';
import { StatsService } from './stats.service';

const ctx = (role: 'owner' | 'user'): BotMessageContext => ({
  userId: 'u1',
  chatId: '1',
  language: 'ru',
  role,
});

function setup() {
  const execute = jest
    .fn()
    .mockResolvedValueOnce({
      rows: [
        {
          total: '12', new1d: '1', new7d: '4', active7d: '7', reachable: '11',
          resume: '9', manual: '2', confirmed: '6', received: '5', applied: '2',
          cards7d: '80', recipients7d: '5', fallback7d: '0',
          blocked7d: '1', deleted7d: '0', deleted_total: '2', feedback7d: '1',
          errors1d: '0', errors7d: '3',
        },
      ],
    })
    .mockResolvedValueOnce({ rows: [{ source: 'friends', count: '5' }, { source: null, count: '7' }] })
    .mockResolvedValueOnce({ rows: [{ place: 'scheduled digest', count: '3' }] });
  const bot = { registerCommand: jest.fn(), sendToUser: jest.fn().mockResolvedValue('1') };
  const service = new StatsService({ execute } as never, bot as never);
  return { service, bot, execute };
}

describe('StatsService', () => {
  it('registers /stats', () => {
    const { service, bot } = setup();
    service.onModuleInit();
    expect(bot.registerCommand).toHaveBeenCalledWith('stats', expect.any(Function));
  });

  it('turns the bigint strings of Postgres into the snapshot', async () => {
    const { service } = setup();
    const s = await service.snapshot(new Date('2026-10-19T12:00:00Z'));
    expect(s.users).toEqual({ total: 12, new1d: 1, new7d: 4, active7d: 7, reachable: 11 });
    expect(s.funnel).toEqual({ resume: 9, manual: 2, confirmed: 6, received: 5, applied: 2 });
    expect(s.week).toEqual({ cards: 80, recipients: 5, fallbackResumes: 0, blocked: 1, deleted: 0, feedback: 1 });
    expect(s.deletedTotal).toBe(2);
    expect(s.sources).toEqual([
      { source: 'friends', count: 5 },
      { source: null, count: 7 },
    ]);
    expect(s.errors).toEqual({ day: 0, week: 3, top: [{ where: 'scheduled digest', count: 3 }] });
  });

  it('sends the owner the report', async () => {
    const { service, bot } = setup();
    await service.show(ctx('owner'));
    const text = bot.sendToUser.mock.calls[0][1] as string;
    expect(text).toContain('📊 Статистика JobRadar');
    expect(text).toContain('Загрузили резюме: 9 (75%)');
    expect(text).toContain('scheduled digest: 3');
  });

  it('refuses everyone else without touching the database', async () => {
    const { service, bot, execute } = setup();
    await service.show(ctx('user'));
    expect(execute).not.toHaveBeenCalled();
    expect(bot.sendToUser).toHaveBeenCalledWith('u1', 'Эта команда доступна только автору.');
  });
});

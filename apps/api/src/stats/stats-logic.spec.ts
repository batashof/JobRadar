import { renderStats, type StatsSnapshot, withShare } from './stats-logic';

const snapshot = (over: Partial<StatsSnapshot> = {}): StatsSnapshot => ({
  users: { total: 40, new1d: 2, new7d: 9, active7d: 25, reachable: 37 },
  funnel: { resume: 30, confirmed: 24, received: 20, applied: 5 },
  week: { cards: 310, recipients: 18, fallbackResumes: 1, blocked: 2, deleted: 1, feedback: 3 },
  deletedTotal: 4,
  sources: [
    { source: null, count: 25 },
    { source: 'friends', count: 10 },
  ],
  errors: { day: 0, week: 4, top: [{ where: '/resume', count: 3 }] },
  ...over,
});

describe('withShare', () => {
  it('adds a whole percent of the base', () => {
    expect(withShare(30, 40)).toBe('30 (75%)');
    expect(withShare(1, 3)).toBe('1 (33%)');
  });

  it('leaves the share out when there is nobody yet', () => {
    expect(withShare(0, 0)).toBe('0');
  });
});

describe('renderStats', () => {
  it('shows users, the funnel with shares, the week, sources and errors (ru)', () => {
    const text = renderStats(snapshot(), 'ru');
    expect(text).toContain('👥 Пользователи: 40 (+2 за сутки, +9 за 7 дней)');
    expect(text).toContain('🟢 Активны за 7 дней: 25 · чат подключён: 37');
    expect(text).toContain('Запустили бота: 40');
    expect(text).toContain('Загрузили резюме: 30 (75%)');
    expect(text).toContain('Подтвердили профиль: 24 (60%)');
    expect(text).toContain('Получили вакансии: 20 (50%)');
    expect(text).toContain('Отметили отклик: 5 (13%)');
    expect(text).toContain('📬 За 7 дней: 310 вакансий 18 пользователям');
    expect(text).toContain('заблокировали бота 2, удалили аккаунт 1 (всего удалено: 4)');
    expect(text).toContain('без метки: 25');
    expect(text).toContain('friends: 10');
    expect(text).toContain('⚠️ Ошибки: 0 за сутки, 4 за 7 дней');
    expect(text).toContain('/resume: 3');
    expect(text).toContain('💬 Отзывов за 7 дней: 3');
  });

  it('speaks English and skips the sources block when nobody came yet', () => {
    const text = renderStats(
      snapshot({
        users: { total: 0, new1d: 0, new7d: 0, active7d: 0, reachable: 0 },
        funnel: { resume: 0, confirmed: 0, received: 0, applied: 0 },
        sources: [],
      }),
      'en',
    );
    expect(text).toContain('👥 Users: 0 (+0 in 24 h, +0 in 7 days)');
    expect(text).toContain('Uploaded a resume: 0');
    expect(text).not.toContain('Where they came from');
  });
});

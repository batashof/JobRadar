import type { Language } from '@jobradar/shared';

/**
 * The numbers behind the owner's `/stats` (v2.6.0), one database round trip
 * apart from the two lists. Owner accounts are left out of every user count.
 */
export interface StatsSnapshot {
  users: {
    total: number;
    new1d: number;
    new7d: number;
    /** Wrote or pressed a button in the bot in the last 7 days (`users.last_seen_at`). */
    active7d: number;
    /** A linked chat: the bot can write to them (not blocked, not /stop). */
    reachable: number;
  };
  /** How far the current users got, all time. `users.total` is the first step. */
  funnel: {
    resume: number;
    confirmed: number;
    received: number;
    applied: number;
  };
  week: {
    /** Vacancy cards sent in the last 7 days, and to how many users. */
    cards: number;
    recipients: number;
    /** Resumes read without the LLM (every provider failed, ADR-017). */
    fallbackResumes: number;
    blocked: number;
    deleted: number;
    feedback: number;
  };
  deletedTotal: number;
  /** Sign-ups by the `?start=` tag of the link they came through; null = no tag. */
  sources: { source: string | null; count: number }[];
  errors: {
    day: number;
    week: number;
    /** The most frequent failure places of the last 7 days. */
    top: { where: string; count: number }[];
  };
}

const TEXT = {
  en: {
    ownerOnly: 'This command is available to the author only.',
    title: '📊 JobRadar stats',
    users: '👥 Users: {total} (+{day} in 24 h, +{week} in 7 days)',
    active: '🟢 Active in 7 days: {active} · chat connected: {reachable}',
    funnel: '🪜 Funnel',
    started: 'Started the bot: {n}',
    resume: 'Uploaded a resume: {n}',
    confirmed: 'Confirmed the profile: {n}',
    received: 'Received vacancies: {n}',
    applied: 'Marked an application: {n}',
    week: '📬 In 7 days: {cards} vacancies to {users} users',
    fallback: '🤖 Resumes read without AI in 7 days: {n}',
    left: '🚪 Left in 7 days: blocked the bot {blocked}, deleted the account {deleted} (deleted in total: {total})',
    sources: '🔗 Where they came from',
    noTag: 'no tag',
    errors: '⚠️ Errors: {day} in 24 h, {week} in 7 days',
    feedback: '💬 Feedback in 7 days: {n}',
  },
  ru: {
    ownerOnly: 'Эта команда доступна только автору.',
    title: '📊 Статистика JobRadar',
    users: '👥 Пользователи: {total} (+{day} за сутки, +{week} за 7 дней)',
    active: '🟢 Активны за 7 дней: {active} · чат подключён: {reachable}',
    funnel: '🪜 Воронка',
    started: 'Запустили бота: {n}',
    resume: 'Загрузили резюме: {n}',
    confirmed: 'Подтвердили профиль: {n}',
    received: 'Получили вакансии: {n}',
    applied: 'Отметили отклик: {n}',
    week: '📬 За 7 дней: {cards} вакансий {users} пользователям',
    fallback: '🤖 Резюме разобрано без AI за 7 дней: {n}',
    left: '🚪 Ушли за 7 дней: заблокировали бота {blocked}, удалили аккаунт {deleted} (всего удалено: {total})',
    sources: '🔗 Откуда пришли',
    noTag: 'без метки',
    errors: '⚠️ Ошибки: {day} за сутки, {week} за 7 дней',
    feedback: '💬 Отзывов за 7 дней: {n}',
  },
} as const;

export type StatsTextKey = keyof (typeof TEXT)['en'];

export function statsText(
  lang: Language,
  key: StatsTextKey,
  values: Record<string, string | number> = {},
): string {
  return Object.entries(values).reduce<string>(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    TEXT[lang][key],
  );
}

/** `n` and its share of `base` as a whole percent; no share when the base is empty. */
export function withShare(n: number, base: number): string {
  if (base <= 0) return String(n);
  return `${n} (${Math.round((n / base) * 100)}%)`;
}

/** The `/stats` message, plain text. */
export function renderStats(s: StatsSnapshot, lang: Language): string {
  const t = (key: StatsTextKey, values?: Record<string, string | number>) => statsText(lang, key, values);
  const base = s.users.total;
  const lines = [
    t('title'),
    '',
    t('users', { total: base, day: s.users.new1d, week: s.users.new7d }),
    t('active', { active: s.users.active7d, reachable: s.users.reachable }),
    '',
    t('funnel'),
    t('started', { n: base }),
    t('resume', { n: withShare(s.funnel.resume, base) }),
    t('confirmed', { n: withShare(s.funnel.confirmed, base) }),
    t('received', { n: withShare(s.funnel.received, base) }),
    t('applied', { n: withShare(s.funnel.applied, base) }),
    '',
    t('week', { cards: s.week.cards, users: s.week.recipients }),
    t('fallback', { n: s.week.fallbackResumes }),
    t('left', { blocked: s.week.blocked, deleted: s.week.deleted, total: s.deletedTotal }),
  ];
  if (s.sources.length > 0) {
    lines.push('', t('sources'));
    for (const { source, count } of s.sources) lines.push(`${source ?? t('noTag')}: ${count}`);
  }
  lines.push('', t('errors', { day: s.errors.day, week: s.errors.week }));
  for (const { where, count } of s.errors.top) lines.push(`${where}: ${count}`);
  lines.push('', t('feedback', { n: s.week.feedback }));
  return lines.join('\n');
}

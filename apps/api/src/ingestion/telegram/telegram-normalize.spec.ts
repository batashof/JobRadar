import {
  extractCompany,
  extractEmploymentType,
  extractSalary,
  extractTitle,
  extractWorkFormat,
  isJunkPost,
  isLikelyVacancy,
  normalizeTelegramMessage,
} from './telegram-normalize';

const SOURCE_ID = '00000000-0000-0000-0000-000000000001';

const RU_POST = `🔥 **Senior Frontend Developer (React)**

Компания: Яндекс
Локация: Москва / удалёнка
Вилка: от 3000 до 5000 $ на руки
Полная занятость.

Ищем сильного фронтендера в команду поиска.
Стек: React, TypeScript, Node.js.
Писать: @recruiter`;

const EN_POST = `Backend Engineer (Go) — remote

Company: Acme Inc
Salary: $4k-6k
Part-time OK.

We are a small fintech startup building payment rails.
Apply: jobs@acme.dev`;

describe('telegram-normalize', () => {
  it('filters out short service posts', () => {
    expect(isLikelyVacancy('Канал вернулся из отпуска!')).toBe(false);
    expect(isLikelyVacancy(RU_POST)).toBe(true);
  });

  it('rejects moderation-bot notices, giveaways and ads even when long enough', () => {
    const banNotice =
      '⛔ vlad pushkov, тебя заблокировали (Lols Ban)\n\n' +
      'Пользователь отмечен к глобальной блокировке в боте (Lols ban) — ' +
      'подробнее о том, что делать в таком случае, можно почитать по ссылке.';
    expect(isJunkPost(banNotice)).toBe(true);
    expect(isLikelyVacancy(banNotice)).toBe(false);

    expect(isJunkPost('Розыгрыш MacBook среди подписчиков! Условия участия внутри поста.')).toBe(
      true,
    );
    expect(isJunkPost('Реклама: наш партнёрский канал с курсами по программированию.')).toBe(true);

    // A real vacancy that merely mentions "заблокировать доступ" is not junk.
    expect(isJunkPost(RU_POST)).toBe(false);
    expect(isJunkPost(EN_POST)).toBe(false);
  });

  it('extracts the first line as the title, stripping markdown and emoji', () => {
    expect(extractTitle(RU_POST)).toBe('Senior Frontend Developer (React)');
    expect(extractTitle(EN_POST)).toBe('Backend Engineer (Go) — remote');
  });

  it('extracts the company from labeled lines', () => {
    expect(extractCompany(RU_POST)).toBe('Яндекс');
    expect(extractCompany(EN_POST)).toBe('Acme Inc');
    expect(extractCompany('no label here')).toBeNull();
  });

  it('detects work format and employment type from keywords', () => {
    expect(extractWorkFormat(RU_POST)).toBe('remote');
    expect(extractWorkFormat('Работа в офисе, Санкт-Петербург')).toBe('onsite');
    expect(extractWorkFormat('Гибридный формат')).toBe('hybrid');
    expect(extractWorkFormat('nothing relevant')).toBeNull();
    expect(extractEmploymentType(RU_POST)).toBe('full_time');
    expect(extractEmploymentType(EN_POST)).toBe('part_time');
    expect(extractEmploymentType('nothing relevant')).toBeNull();
  });

  it('parses salary ranges with currency markers', () => {
    expect(extractSalary(RU_POST)).toEqual({
      salaryMin: 3000,
      salaryMax: 5000,
      salaryCurrency: 'USD',
    });
    expect(extractSalary(EN_POST)).toEqual({
      salaryMin: 4000,
      salaryMax: 6000,
      salaryCurrency: 'USD',
    });
    expect(extractSalary('до 300 000 ₽')).toEqual({
      salaryMin: null,
      salaryMax: 300_000,
      salaryCurrency: 'RUB',
    });
    expect(extractSalary('от 2500 eur')).toEqual({
      salaryMin: 2500,
      salaryMax: null,
      salaryCurrency: 'EUR',
    });
  });

  it('ignores bare number ranges without a currency (dates, ids)', () => {
    expect(extractSalary('Работаем 10-19 по Москве, опыт 3-5 лет')).toEqual({
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
    });
  });

  it('normalizes a full message with t.me deep link and channel-scoped external id', () => {
    const row = normalizeTelegramMessage(
      { channel: 'it_jobs', messageId: 421, text: RU_POST, date: new Date('2026-07-19T10:00:00Z') },
      SOURCE_ID,
    );
    expect(row).toMatchObject({
      sourceId: SOURCE_ID,
      externalId: 'it_jobs:421',
      url: 'https://t.me/it_jobs/421',
      title: 'Senior Frontend Developer (React)',
      companyRaw: 'Яндекс',
      workFormat: 'remote',
      employmentType: 'full_time',
      salaryMin: 3000,
      salaryMax: 5000,
      salaryCurrency: 'USD',
      location: 'Москва / удалёнка',
    });
    expect(row?.publishedAt).toEqual(new Date('2026-07-19T10:00:00Z'));
  });

  it('falls back to the channel handle when no company is labeled', () => {
    const row = normalizeTelegramMessage(
      { channel: 'go_jobs', messageId: 7, text: EN_POST.replace(/^Company:.*$\n/m, ''), date: null },
      SOURCE_ID,
    );
    expect(row?.companyRaw).toBe('@go_jobs');
  });

  it('returns null for non-vacancy posts', () => {
    expect(
      normalizeTelegramMessage(
        { channel: 'it_jobs', messageId: 1, text: 'Реклама: подпишись!', date: null },
        SOURCE_ID,
      ),
    ).toBeNull();
  });
});

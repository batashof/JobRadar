import type { ScoredCandidate } from './select';
import { renderCardParts, renderHeader, renderKeyboard } from './render';

const item = (over: Partial<ScoredCandidate> = {}): ScoredCandidate => ({
  id: '11111111-2222-3333-4444-555555555555',
  title: 'Senior Frontend Engineer',
  company: 'Acme',
  description: '',
  location: 'Remote (EU)',
  seniority: 'senior',
  salaryMin: 5000,
  salaryMax: 7000,
  salaryCurrency: 'USD',
  workFormat: 'remote',
  employmentType: 'full_time',
  applyContact: null,
  sourceSlug: 'remoteok',
  url: 'https://acme.test/jobs/1',
  publishedAt: new Date('2026-08-10T00:00:00Z'),
  ruleScore: 0.8,
  resumeScore: 0,
  lexScore: 0,
  score: 84,
  note: 'Стек совпадает почти полностью',
  ...over,
});

describe('renderHeader', () => {
  it('counts the vacancies, with a singular form', () => {
    expect(renderHeader('ru', 5)).toContain('5 вакансий');
    expect(renderHeader('ru', 1)).toContain('одна вакансия');
    expect(renderHeader('en', 3)).toContain('3 vacancies');
  });
});

describe('renderCardParts', () => {
  /** Telegram's own ceiling — every part has to stay under it. */
  const MESSAGE_LIMIT = 4096;

  const filler = (length: number) => 'слово '.repeat(Math.ceil(length / 6)).slice(0, length);

  it('leads with the title and shows the fit, salary and location', () => {
    const [card] = renderCardParts(item(), 'ru');
    expect(card).toContain('<b>Senior Frontend Engineer</b>');
    expect(card).toContain('Acme');
    expect(card).toContain('84% соответствие');
    expect(card).toContain('5000–7000 USD');
    expect(card).toContain('Remote (EU)');
    expect(card).toContain('<i>Стек совпадает почти полностью</i>');
  });

  it('carries the posting itself, not just the headline', () => {
    const description = 'Мы ищем инженера. • React и TypeScript • Опыт от 5 лет';
    const [card] = renderCardParts(item({ description }), 'ru');
    expect(card).toContain('Мы ищем инженера.');
    expect(card).toContain('Опыт от 5 лет');
    // Bullets survive as a list: ingestion collapsed the original line breaks.
    expect(card).toContain('\n• React и TypeScript');
  });

  it('shows the format, employment type, publication date, source and contact', () => {
    const [card] = renderCardParts(
      item({ applyContact: { kind: 'email', value: 'jobs@acme.test' } }),
      'ru',
      'Europe/Moscow',
    );
    expect(card).toContain('Удалённо');
    expect(card).toContain('Полная занятость');
    expect(card).toContain('опубликовано');
    expect(card).toContain('remoteok');
    expect(card).toContain('Контакт: jobs@acme.test');
  });

  it('keeps a whole posting in one message when it fits', () => {
    expect(renderCardParts(item({ description: filler(1000) }), 'ru')).toHaveLength(1);
  });

  it('splits a long posting across messages, each inside the Telegram limit', () => {
    const parts = renderCardParts(item({ description: filler(6000) }), 'ru');

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
    // Continuations say what they continue, so a stray message is never orphaned.
    expect(parts[1]).toContain('Senior Frontend Engineer — продолжение');
  });

  it('caps a monster posting and points at the app for the rest', () => {
    const parts = renderCardParts(item({ description: filler(40_000) }), 'ru');

    expect(parts).toHaveLength(3);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
    expect(parts.at(-1)).toContain('«Подробнее»');
  });

  it('never splits mid-word', () => {
    const parts = renderCardParts(item({ description: filler(6000) }), 'ru');
    for (const part of parts) expect(part).not.toMatch(/сло$|слов$/);
  });

  it('escapes scraped text — titles and postings come from arbitrary job posts', () => {
    const [card] = renderCardParts(
      item({ title: '<script>alert(1)</script> & co', note: '', description: '<b>hi</b> & bye' }),
      'ru',
    );
    expect(card).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; co');
    expect(card).toContain('&lt;b&gt;hi&lt;/b&gt; &amp; bye');
    expect(card).not.toContain('<script>');
  });

  it('never cuts an escaped entity in half', () => {
    // A description of nothing but ampersands is the worst case for a cut made
    // after escaping: every character becomes five.
    for (const part of renderCardParts(item({ description: '& '.repeat(4000) }), 'ru')) {
      expect(part).not.toMatch(/&(?!amp;|quot;|lt;|gt;)/);
    }
  });

  it('omits the salary line when the vacancy has none', () => {
    const [card] = renderCardParts(
      item({ salaryMin: null, salaryMax: null, salaryCurrency: null }),
      'ru',
    );
    expect(card).not.toContain('USD');
    expect(card).toContain('84% соответствие');
  });

  it('omits the note when the model gave none', () => {
    expect(renderCardParts(item({ note: '' }), 'ru')[0]).not.toContain('<i>');
  });

  it('falls back to UTC when the stored timezone is nonsense', () => {
    expect(() => renderCardParts(item(), 'ru', 'Mars/Olympus')).not.toThrow();
  });
});

describe('renderKeyboard', () => {
  it('makes Apply a callback — the point is not leaving the chat', () => {
    const keyboard = renderKeyboard(item(), 'ru', 'https://web.test');
    expect(keyboard[0]).toEqual([
      // Namespaced to outreach: this module renders the button without knowing
      // how applying works.
      { text: 'Откликнуться', callbackData: `a:d:${item().id}` },
      { text: 'Подробнее', url: `https://web.test/app/vacancies/${item().id}` },
    ]);
  });

  it('falls back to the original posting when no web origin is configured', () => {
    expect(renderKeyboard(item(), 'ru', '')[0]?.[1]?.url).toBe('https://acme.test/jobs/1');
  });

  it('keeps callback data inside the 64-byte Telegram limit', () => {
    for (const button of renderKeyboard(item(), 'ru', 'https://web.test').flat()) {
      if (button.callbackData) {
        expect(Buffer.byteLength(button.callbackData)).toBeLessThanOrEqual(64);
      }
    }
  });

  it('offers both thumbs and hide, namespaced to the digest', () => {
    const actions = renderKeyboard(item(), 'ru', 'https://web.test')[1] ?? [];
    expect(actions.map((button) => button.callbackData)).toEqual([
      `d:u:${item().id}`,
      `d:w:${item().id}`,
      `d:h:${item().id}`,
    ]);
  });
});

import type { ScoredCandidate } from './select';
import { renderCard, renderHeader, renderKeyboard } from './render';

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
  url: 'https://acme.test/jobs/1',
  publishedAt: new Date('2026-08-10T00:00:00Z'),
  ruleScore: 0.8,
  resumeScore: 0,
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

describe('renderCard', () => {
  it('leads with the title and shows the fit, salary and location', () => {
    const card = renderCard(item(), 'ru');
    expect(card).toContain('<b>Senior Frontend Engineer</b>');
    expect(card).toContain('Acme');
    expect(card).toContain('84% соответствие');
    expect(card).toContain('5000–7000 USD');
    expect(card).toContain('Remote (EU)');
    expect(card).toContain('<i>Стек совпадает почти полностью</i>');
  });

  it('escapes scraped text — titles come from arbitrary job posts', () => {
    const card = renderCard(item({ title: '<script>alert(1)</script> & co', note: '' }), 'ru');
    expect(card).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; co');
    expect(card).not.toContain('<script>');
  });

  it('omits the salary line when the vacancy has none', () => {
    const card = renderCard(
      item({ salaryMin: null, salaryMax: null, salaryCurrency: null }),
      'ru',
    );
    expect(card).not.toContain('USD');
    expect(card).toContain('84% соответствие');
  });

  it('omits the note when the model gave none', () => {
    expect(renderCard(item({ note: '' }), 'ru')).not.toContain('<i>');
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

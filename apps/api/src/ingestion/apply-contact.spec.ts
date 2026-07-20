import { extractApplyContact } from './apply-contact';

describe('extractApplyContact', () => {
  it('returns null for empty or contact-free text', () => {
    expect(extractApplyContact('')).toBeNull();
    expect(
      extractApplyContact('Senior React Developer\nRemote, full-time\nGreat team, big salary.'),
    ).toBeNull();
  });

  it('prefers an email over everything else', () => {
    const text = 'Отклик: пишите @hr_maria или на почту jobs@acme.dev\nhttps://t.me/acme_hr';
    expect(extractApplyContact(text)).toEqual({ kind: 'email', value: 'jobs@acme.dev' });
  });

  it('finds a telegram handle on a contact line', () => {
    const text = 'Мы ищем реакт-разработчика.\nКонтакты: @maria_hr\nПодписывайтесь: @channel_promo';
    expect(extractApplyContact(text)).toEqual({ kind: 'telegram', value: '@maria_hr' });
  });

  it('ignores bare handles that are not on a contact line (channel self-promo)', () => {
    const text = 'Больше вакансий в Frontend & Node.js: @forfrontend';
    expect(extractApplyContact(text)).toBeNull();
  });

  it('accepts a t.me link anywhere as a telegram contact', () => {
    const text = 'Apply: отличная команда.\nhttps://t.me/acme_recruiter';
    expect(extractApplyContact(text)).toEqual({ kind: 'telegram', value: '@acme_recruiter' });
  });

  it('skips reserved t.me paths', () => {
    expect(extractApplyContact('Наш чат: https://t.me/joinchat/AbCdEf123')).toBeNull();
  });

  it('falls back to an apply URL on a contact line, stripping trailing punctuation', () => {
    const text = 'Senior role.\nApply here: https://jobs.acme.dev/senior-react.';
    expect(extractApplyContact(text)).toEqual({
      kind: 'url',
      value: 'https://jobs.acme.dev/senior-react',
    });
  });

  it('does not treat arbitrary links as apply URLs', () => {
    expect(extractApplyContact('Смотрите наш сайт https://acme.dev для деталей')).toBeNull();
  });

  it('handles a realistic RU telegram vacancy', () => {
    const text = [
      'Frontend-разработчик — React',
      '#удаленка #middle',
      'Компания: Acme',
      'Зарплата: 3000–4000 USD',
      'Чем предстоит заниматься: разработка SPA.',
      'Резюме и вопросы: @acme_talent',
    ].join('\n');
    expect(extractApplyContact(text)).toEqual({ kind: 'telegram', value: '@acme_talent' });
  });
});

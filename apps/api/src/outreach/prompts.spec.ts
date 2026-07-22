import {
  buildApplyEmailPrompt,
  buildBriefPrompt,
  buildCoverLetterPrompt,
  parseApplyEmail,
  truncate,
  VACANCY_TEXT_LIMIT,
} from './prompts';

const vacancy = {
  title: 'Senior React Developer',
  company: 'Acme',
  description: 'Разработка SPA на React. Удалёнка.',
  location: 'Remote',
};

describe('truncate', () => {
  it('leaves short text alone and cuts long text with an ellipsis', () => {
    expect(truncate('short', 10)).toBe('short');
    const long = 'x'.repeat(VACANCY_TEXT_LIMIT + 100);
    const cut = truncate(long, VACANCY_TEXT_LIMIT);
    expect(cut.length).toBe(VACANCY_TEXT_LIMIT + 1);
    expect(cut.endsWith('…')).toBe(true);
  });
});

describe('buildBriefPrompt', () => {
  it('defaults to Russian and includes the vacancy text', () => {
    const { system, user } = buildBriefPrompt(vacancy, null);
    expect(system).toContain('по-русски');
    expect(user).toContain('Senior React Developer — Acme (Remote)');
    expect(user).toContain('Разработка SPA');
    // no resume → the fit section asks who the vacancy targets instead
    expect(user).not.toContain('Резюме кандидата');
  });

  it('adds the Russian resume fit section when a resume is available', () => {
    const { user } = buildBriefPrompt(vacancy, 'React dev, 8 years', 'ru');
    expect(user).toContain('Резюме кандидата');
    expect(user).toContain('React dev, 8 years');
    expect(user).toContain('Соответствие кандидату');
  });

  it('builds an English brief when lang is en', () => {
    const { system, user } = buildBriefPrompt(vacancy, null, 'en');
    expect(system).toContain('English only');
    expect(system).not.toContain('по-русски');
    expect(user).toContain('Write a short vacancy brief');
    expect(user).toContain('Senior React Developer — Acme (Remote)');
    expect(user).not.toContain('Резюме кандидата');
  });

  it('adds the English resume fit section when a resume is available', () => {
    const { user } = buildBriefPrompt(vacancy, 'React dev, 8 years', 'en');
    expect(user).toContain('Candidate resume');
    expect(user).toContain('React dev, 8 years');
    expect(user).toContain('Fit for the candidate');
  });
});

describe('buildCoverLetterPrompt', () => {
  it('pins the language, length, and honesty rules', () => {
    const { system, user } = buildCoverLetterPrompt(vacancy, 'Resume text. English — B1.');
    expect(system).toContain('language the vacancy text is written in');
    expect(system).toContain('never write above it');
    expect(system).toContain('120–180 words');
    expect(system).toContain('Never invent facts');
    expect(user).toContain('Resume text. English — B1.');
  });
});

describe('apply email prompt round-trip', () => {
  it('builds a prompt that demands the SUBJECT/BODY format and parses it back', () => {
    const { system } = buildApplyEmailPrompt(vacancy, 'Dear team…', 'me@example.com');
    expect(system).toContain('SUBJECT:');
    expect(system).toContain('BODY:');

    const parsed = parseApplyEmail(
      'SUBJECT: Senior React Developer — 8 years of React\nBODY:\nHello,\n\nDear team…\n\nResume attached.',
    );
    expect(parsed).toEqual({
      subject: 'Senior React Developer — 8 years of React',
      body: 'Hello,\n\nDear team…\n\nResume attached.',
    });
  });

  it('returns null on malformed replies', () => {
    expect(parseApplyEmail('here is your email!')).toBeNull();
    expect(parseApplyEmail('SUBJECT: only a subject')).toBeNull();
  });
});

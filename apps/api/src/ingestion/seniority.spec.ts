import {
  detectSeniority,
  detectVacancySeniority,
  levelsBelowResume,
  seniorityRank,
} from '@jobradar/shared';

describe('detectSeniority (shared, ADR-012)', () => {
  it('reads the level from an English title', () => {
    expect(detectSeniority('Senior Frontend Engineer')).toBe('senior');
    expect(detectSeniority('Junior React Developer')).toBe('junior');
    expect(detectSeniority('Backend Internship')).toBe('intern');
    expect(detectSeniority('Team Lead, Platform')).toBe('lead');
  });

  it('reads Russian level words', () => {
    expect(detectSeniority('Старший разработчик')).toBe('senior');
    expect(detectSeniority('Младший фронтенд-разработчик')).toBe('junior');
    expect(detectSeniority('Стажёр в команду мобильной разработки')).toBe('intern');
    expect(detectSeniority('Ведущий инженер')).toBe('lead');
  });

  it('returns null when no level word is present', () => {
    expect(detectSeniority('Frontend Engineer')).toBeNull();
    expect(detectSeniority('Разработчик React')).toBeNull();
    expect(detectSeniority('')).toBeNull();
  });

  it('picks the highest level when several appear', () => {
    // "not a junior role — senior only" must classify as senior, not junior.
    expect(detectSeniority('Senior Engineer (not a junior position)')).toBe('senior');
    expect(detectSeniority('Middle/Senior Golang Developer')).toBe('senior');
  });

  it('does not match level words embedded in other words', () => {
    // "lead" must not fire on "leadership"; "sr" not on "usr".
    expect(detectSeniority('Frontend Developer with leadership skills')).toBeNull();
  });

  it('ranks levels in ascending seniority', () => {
    expect(seniorityRank('intern')).toBeLessThan(seniorityRank('junior'));
    expect(seniorityRank('senior')).toBeLessThan(seniorityRank('lead'));
  });
});

describe('detectVacancySeniority (ADR-012 revised)', () => {
  it('takes the level from the title', () => {
    expect(detectVacancySeniority('Senior Frontend Engineer', 'anything')).toBe('senior');
    expect(detectVacancySeniority('Стажёр-разработчик', '')).toBe('intern');
  });

  it('ignores level words used as prose in the description', () => {
    // The bug this replaces: scanning the whole posting labelled 45% of the
    // production board `lead`, because descriptions say things like this.
    expect(
      detectVacancySeniority(
        'Senior Software Engineer',
        'You will lead the team, work with our staff of 200 and report to the principal architect.',
      ),
    ).toBe('senior');
    expect(
      detectVacancySeniority('Frontend Developer', 'You will lead projects and mentor juniors.'),
    ).toBeNull();
  });

  it('never lets a description outrank the title', () => {
    // The real row: an intern posting stored as `senior` sailed through the
    // filter it exists to trip.
    expect(
      detectVacancySeniority(
        'Junior Front End Development Analyst/Intern',
        'Work alongside our senior engineers on production systems.',
      ),
    ).toBe('junior');
  });

  it('reads an explicit hashtag when the title says nothing', () => {
    // How the Telegram channels actually state a level.
    expect(detectVacancySeniority('Frontend-разработчик', '#удаленка #middle Компания: X')).toBe(
      'middle',
    );
    expect(detectVacancySeniority('Fullstack Engineer', '#senior #remote')).toBe('senior');
    expect(detectVacancySeniority('React разработчик', '#junior #remote')).toBe('junior');
  });

  it('takes the highest of several hashtags, as a range implies the ceiling', () => {
    expect(detectVacancySeniority('QA-инженер', '#удаленка #middle #senior')).toBe('senior');
  });

  it('does not read a bare word in the body as a hashtag', () => {
    expect(detectVacancySeniority('Frontend Developer', 'a senior colleague will mentor you')).toBeNull();
  });

  it('says nothing rather than guessing — an unlabelled row passes the filter', () => {
    expect(detectVacancySeniority('Frontend Engineer', 'We build web apps.')).toBeNull();
    expect(detectVacancySeniority('Frontend Engineer', null)).toBeNull();
    expect(detectVacancySeniority('', '')).toBeNull();
  });
});

describe('levelsBelowResume', () => {
  it('drops only grades two or more below (a senior keeps middle)', () => {
    expect(levelsBelowResume('senior')).toEqual(['intern', 'junior']);
  });

  it('lets a middle resume drop just interns', () => {
    expect(levelsBelowResume('middle')).toEqual(['intern']);
  });

  it('filters nothing for a junior resume', () => {
    expect(levelsBelowResume('junior')).toEqual([]);
  });

  it('a lead resume drops up to middle', () => {
    expect(levelsBelowResume('lead')).toEqual(['intern', 'junior', 'middle']);
  });
});

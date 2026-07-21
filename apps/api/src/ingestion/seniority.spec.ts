import { detectSeniority, levelsBelowResume, seniorityRank } from '@jobradar/shared';

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

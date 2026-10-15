import { canonicalSkill, relatedSkills, skillLabel } from '@jobradar/shared';

import {
  applyFeedback,
  detectVacancySkills,
  EMPTY_FEEDBACK,
  explainScore,
  FAR_GRADE_CAP,
  FEEDBACK_MAX_POINTS,
  passesPreferences,
  roleFamily,
  type ScoringProfile,
  type ScoringVacancy,
  scoreVacancy,
  WRONG_FAMILY_CAP,
} from './score';

const now = new Date('2026-10-15T12:00:00Z');

const frontend: ScoringProfile = {
  role: 'Frontend Developer',
  grade: 'senior',
  skills: [
    { name: 'React', weight: 'core' },
    { name: 'TypeScript', weight: 'core' },
    { name: 'Redux', weight: 'core' },
    { name: 'Next.js', weight: 'familiar' },
    { name: 'Cypress', weight: 'familiar' },
  ],
};

const vacancy = (overrides: Partial<ScoringVacancy>): ScoringVacancy => ({
  title: 'Senior Frontend Engineer',
  company: 'Acme',
  description: 'We build with React, TypeScript and GraphQL.',
  seniority: 'senior',
  publishedAt: now,
  ...overrides,
});

describe('skill dictionary', () => {
  it('resolves spellings to one key', () => {
    expect(canonicalSkill('ReactJS')).toBe('react');
    expect(canonicalSkill(' React.js ')).toBe('react');
    expect(canonicalSkill('Postgres')).toBe('postgresql');
    expect(canonicalSkill('Some Niche Tool')).toBe('some niche tool');
  });

  it('treats relations as symmetric', () => {
    expect(relatedSkills('vue')).toContain('react');
    expect(relatedSkills('react')).toContain('vue');
    expect(relatedSkills('react')).not.toContain('react');
  });

  it('labels known keys and passes unknown ones through', () => {
    expect(skillLabel('next.js')).toBe('Next.js');
    expect(skillLabel('foo')).toBe('foo');
  });

  it('does not read ordinary words as technologies', () => {
    expect(detectVacancySkills('Engineer', 'You will go far and express ideas in spring.')).toEqual([]);
    expect(detectVacancySkills('Go Developer', 'Golang, Spring Boot')).toEqual(
      expect.arrayContaining(['go', 'spring']),
    );
  });
});

describe('roleFamily', () => {
  it.each([
    ['Senior Frontend Developer', 'frontend'],
    ['Front-end engineer', 'frontend'],
    ['Fullstack Developer', 'fullstack'],
    ['Backend Engineer', 'backend'],
    ['React developer', null],
    [null, null],
  ])('%s → %s', (role, family) => {
    expect(roleFamily(role)).toBe(family);
  });
});

describe('scoreVacancy', () => {
  it('scores a matching senior frontend role high and explains it', () => {
    const result = scoreVacancy(frontend, vacancy({}), { now });
    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.matched).toEqual(['React', 'TypeScript']);
    expect(result.missing).toEqual(['GraphQL']);
    expect(result.grade).toBe('match');
    expect(explainScore(result, 'en')).toBe(
      'Matched: React, TypeScript; missing: GraphQL; grade: Senior ✓',
    );
    expect(explainScore(result, 'ru')).toBe(
      'Совпало: React, TypeScript; нет: GraphQL; грейд: Senior ✓',
    );
  });

  it('demotes a title on a framework the candidate does not use', () => {
    const react = scoreVacancy(frontend, vacancy({ title: 'Senior Front-End Developer (React)' }), { now });
    const vue = scoreVacancy(
      frontend,
      vacancy({ title: 'Senior Front-End Developer Vue.js', description: 'Vue 3, TypeScript.' }),
      { now },
    );
    const aem = scoreVacancy(frontend, vacancy({ title: 'Senior Frontend Developer (AEM / CMS Experience)' }), {
      now,
    });
    expect(vue.score).toBeLessThan(react.score - 10);
    expect(aem.score).toBeLessThan(react.score - 5);
  });

  it('reads a Portuguese middle title as one grade below senior', () => {
    const result = scoreVacancy(frontend, vacancy({ title: 'Desenvolvedor Pleno Front end', seniority: null }), {
      now,
    });
    expect(result.vacancyLevel).toBe('middle');
    expect(result.grade).toBe('below');
  });

  it('is deterministic', () => {
    const a = scoreVacancy(frontend, vacancy({}), { now });
    const b = scoreVacancy(frontend, vacancy({}), { now });
    expect(a).toEqual(b);
  });

  it('gives adjacent technologies half credit', () => {
    const vue = scoreVacancy(frontend, vacancy({ description: 'Vue 3, Nuxt, TypeScript' }), { now });
    const angular = scoreVacancy(frontend, vacancy({ description: 'Elixir, Kafka, TypeScript' }), {
      now,
    });
    expect(vue.related).toEqual(expect.arrayContaining(['Vue', 'Nuxt']));
    expect(vue.score).toBeGreaterThan(angular.score);
  });

  it('caps another job family however the description reads', () => {
    const result = scoreVacancy(
      frontend,
      vacancy({ title: 'Senior Backend Engineer', description: 'React, TypeScript, Redux, Next.js' }),
      { now },
    );
    expect(result.score).toBeLessThanOrEqual(WRONG_FAMILY_CAP);
  });

  it('accepts a fullstack title for a frontend candidate', () => {
    const result = scoreVacancy(frontend, vacancy({ title: 'Senior Fullstack Engineer' }), { now });
    expect(result.score).toBeGreaterThan(WRONG_FAMILY_CAP);
  });

  it('caps a posting two grades away', () => {
    const result = scoreVacancy(frontend, vacancy({ title: 'Junior Frontend Developer', seniority: 'junior' }), {
      now,
    });
    expect(result.grade).toBe('far');
    expect(result.score).toBeLessThanOrEqual(FAR_GRADE_CAP);
  });

  it('reads the level from the title when ingestion left it empty', () => {
    const result = scoreVacancy(frontend, vacancy({ title: 'Lead Frontend Developer', seniority: null }), {
      now,
    });
    expect(result.vacancyLevel).toBe('lead');
    expect(result.grade).toBe('above');
  });

  it('prefers fresh postings', () => {
    const fresh = scoreVacancy(frontend, vacancy({}), { now });
    const old = scoreVacancy(frontend, vacancy({ publishedAt: new Date('2026-09-20T00:00:00Z') }), {
      now,
    });
    expect(fresh.score).toBeGreaterThan(old.score);
  });

  it('matches skills outside the dictionary literally', () => {
    const profile: ScoringProfile = { ...frontend, skills: [{ name: 'Lit', weight: 'core' }] };
    const result = scoreVacancy(profile, vacancy({ description: 'Web components with Lit' }), { now });
    expect(result.matched).toEqual(['lit']);
  });

  it('applies feedback within bounds', () => {
    const base = scoreVacancy(frontend, vacancy({}), { now }).score;
    const liked = scoreVacancy(frontend, vacancy({}), {
      now,
      weights: { skills: {}, companies: { acme: 0.5 } },
    }).score;
    const hated = scoreVacancy(frontend, vacancy({}), {
      now,
      weights: { skills: { graphql: -0.5, react: -0.5, typescript: -0.5 }, companies: { acme: -1 } },
    }).score;
    expect(liked).toBe(Math.min(100, base + 5));
    expect(base - hated).toBe(FEEDBACK_MAX_POINTS);
  });

  it('survives an empty profile', () => {
    const result = scoreVacancy({ role: null, grade: null, skills: [] }, vacancy({}), { now });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.matched).toEqual([]);
  });
});

describe('applyFeedback', () => {
  const press = { company: 'Acme Corp', vacancySkills: ['react', 'angular'], coreSkills: ['React'] };

  it('raises company and skills on a like', () => {
    const next = applyFeedback(EMPTY_FEEDBACK, { ...press, kind: 'up' });
    expect(next.companies['acme corp']).toBe(0.2);
    expect(next.skills).toEqual({ react: 0.1, angular: 0.1 });
  });

  it('never demotes the candidate core stack on a dislike', () => {
    const next = applyFeedback(EMPTY_FEEDBACK, { ...press, kind: 'down' });
    expect(next.companies['acme corp']).toBe(-0.2);
    expect(next.skills).toEqual({ angular: -0.1 });
  });

  it('only touches the company on hide', () => {
    const next = applyFeedback(EMPTY_FEEDBACK, { ...press, kind: 'hide' });
    expect(next).toEqual({ skills: {}, companies: { 'acme corp': -0.3 } });
  });

  it('stays within bounds and does not mutate its input', () => {
    let weights = EMPTY_FEEDBACK;
    for (let i = 0; i < 20; i += 1) weights = applyFeedback(weights, { ...press, kind: 'up' });
    expect(weights.companies['acme corp']).toBe(0.5);
    expect(weights.skills.react).toBe(0.5);
    for (let i = 0; i < 20; i += 1) weights = applyFeedback(weights, { ...press, kind: 'hide' });
    expect(weights.companies['acme corp']).toBe(-1);
    expect(EMPTY_FEEDBACK).toEqual({ skills: {}, companies: {} });
  });
});

describe('passesPreferences', () => {
  const none = { workFormats: [], employmentTypes: [], minSalaryUsd: null };
  const posting = {
    workFormat: 'onsite' as const,
    employmentType: 'full_time' as const,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
  };

  it('passes everything with no preferences', () => {
    expect(passesPreferences(none, posting)).toBe(true);
  });

  it('filters a stated format or employment the user excluded', () => {
    expect(passesPreferences({ ...none, workFormats: ['remote'] }, posting)).toBe(false);
    expect(passesPreferences({ ...none, workFormats: ['remote'] }, { ...posting, workFormat: null })).toBe(true);
    expect(passesPreferences({ ...none, employmentTypes: ['freelance'] }, posting)).toBe(false);
  });

  it('compares USD salaries, reading large numbers as annual', () => {
    const prefs = { ...none, minSalaryUsd: 4000 };
    expect(passesPreferences(prefs, { ...posting, salaryMax: 3000, salaryCurrency: 'USD' })).toBe(false);
    expect(passesPreferences(prefs, { ...posting, salaryMax: 5000, salaryCurrency: 'usd' })).toBe(true);
    expect(passesPreferences(prefs, { ...posting, salaryMax: 60000, salaryCurrency: 'USD' })).toBe(true);
    expect(passesPreferences(prefs, { ...posting, salaryMax: 36000, salaryCurrency: 'USD' })).toBe(false);
    expect(passesPreferences(prefs, { ...posting, salaryMax: 1000, salaryCurrency: 'EUR' })).toBe(true);
  });
});

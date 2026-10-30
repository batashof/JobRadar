import {
  ANALYSIS_PROMPT_VERSION,
  buildAnalysisPrompt,
  completeSkills,
  dedupeSkills,
  displaySkill,
  fallbackProfile,
  parseAnalysis,
  reconcileAnalysis,
  statedYears,
} from './analysis';

const validReply = {
  role: 'Frontend Developer',
  grade: 'senior',
  years: 8,
  skills: [
    { name: 'React', weight: 'core' },
    { name: 'TypeScript', weight: 'core' },
    { name: 'react', weight: 'familiar' },
    { name: 'GraphQL', weight: 'familiar' },
  ],
  english: 'B2',
  location: 'Minsk, Belarus',
  salaryUsd: null,
  evaluation: {
    strengths: ['Eight years of React with measurable results'],
    gaps: ['No testing tools named'],
    suggestions: ['Add Jest and Cypress to the skills section'],
  },
};

describe('buildAnalysisPrompt', () => {
  it('puts the resume in the user message and asks for the review in the account language', () => {
    const prompt = buildAnalysisPrompt('React developer, 8 years', 'ru');
    expect(prompt.user).toContain('React developer, 8 years');
    expect(prompt.system).toContain('in Russian');
    expect(prompt.system).toContain('"grade"');
  });

  it('cuts a pathological resume to a size a free tier accepts', () => {
    const prompt = buildAnalysisPrompt('x'.repeat(50_000), 'en');
    expect(prompt.user.length).toBeLessThan(13_000);
  });

  it('has a prompt version to store on profiles', () => {
    expect(ANALYSIS_PROMPT_VERSION).toBeGreaterThanOrEqual(2);
  });

  it('tells the model today\'s date, a stated "N+ years" and that JavaScript is its own skill', () => {
    const { system } = buildAnalysisPrompt('cv', 'en', new Date('2026-10-30T12:00:00Z'));
    expect(system).toContain('2026-10-30');
    expect(system).toContain('8+ years');
    expect(system).toContain('JavaScript and TypeScript are two skills');
  });
});

describe('reconcileAnalysis (the resume text wins)', () => {
  const analysis = parseAnalysis(JSON.stringify({ ...validReply, years: 7 }))!;

  it('reads a stated number of years in English and Russian', () => {
    expect(statedYears('Senior Frontend Engineer with 8+ years of experience')).toBe(8);
    expect(statedYears('Опыт: более 8 лет; 3 года в EPAM')).toBe(8);
    expect(statedYears('React 18, 2019 – present, 1.5 years')).toBeNull();
    expect(statedYears('no number here')).toBeNull();
  });

  it('takes the stated years over a smaller count from dates, never a smaller one', () => {
    expect(reconcileAnalysis(analysis, '8+ years building web apps').years).toBe(8);
    expect(reconcileAnalysis({ ...analysis, years: null }, '8+ years').years).toBe(8);
    expect(reconcileAnalysis({ ...analysis, years: 10 }, '2 years at EPAM').years).toBe(10);
    expect(reconcileAnalysis(analysis, 'no stated years').years).toBe(7);
  });

  it('adds a language the model folded into another: core when the resume keeps naming it', () => {
    const text = 'Skills: JavaScript, TypeScript, React. Built JS widgets; JavaScript (ES6+) since 2017.';
    const skills = completeSkills(
      [
        { name: 'React', weight: 'core' },
        { name: 'TypeScript', weight: 'core' },
        { name: 'GraphQL', weight: 'familiar' },
      ],
      text,
    );
    expect(skills).toEqual([
      { name: 'React', weight: 'core' },
      { name: 'TypeScript', weight: 'core' },
      { name: 'JavaScript', weight: 'core' },
      { name: 'GraphQL', weight: 'familiar' },
    ]);
  });

  it('adds a skill named once as familiar, by its dictionary label, and ignores plain words', () => {
    const skills = completeSkills([{ name: 'React', weight: 'core' }], 'React, ReactJS, used Docker once; go to market');
    expect(skills).toEqual([
      { name: 'React', weight: 'core' },
      { name: 'Docker', weight: 'familiar' },
    ]);
  });

  it('keeps the model\'s core skills when the list is full, dropping its last familiar ones', () => {
    const full = [
      ...Array.from({ length: 10 }, (_, i) => ({ name: `Core${i}`, weight: 'core' as const })),
      ...Array.from({ length: 10 }, (_, i) => ({ name: `Also${i}`, weight: 'familiar' as const })),
    ];
    const skills = completeSkills(full, 'JavaScript, JavaScript, JavaScript');
    expect(skills).toHaveLength(20);
    expect(skills[10]).toEqual({ name: 'JavaScript', weight: 'core' });
    expect(skills.map((s) => s.name)).not.toContain('Also9');
  });
});

describe('parseAnalysis', () => {
  it('accepts valid JSON wrapped in a code fence and dedupes skills', () => {
    const parsed = parseAnalysis('```json\n' + JSON.stringify(validReply) + '\n```');
    expect(parsed).toMatchObject({ role: 'Frontend Developer', grade: 'senior', english: 'B2' });
    expect(parsed?.skills.map((s) => s.name)).toEqual(['React', 'TypeScript', 'GraphQL']);
  });

  it('turns an off-list grade or English level into null instead of rejecting the profile', () => {
    const parsed = parseAnalysis(JSON.stringify({ ...validReply, grade: 'rockstar', english: 'fluent' }));
    expect(parsed?.grade).toBeNull();
    expect(parsed?.english).toBeNull();
  });

  it('rejects a reply without a role or skills, or that is not JSON', () => {
    expect(parseAnalysis(JSON.stringify({ ...validReply, role: '' }))).toBeNull();
    expect(parseAnalysis(JSON.stringify({ ...validReply, skills: [] }))).toBeNull();
    expect(parseAnalysis('I cannot help with that.')).toBeNull();
    expect(parseAnalysis('{ broken json')).toBeNull();
  });

  it('keeps at most four evaluation items per section', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f'];
    const parsed = parseAnalysis(
      JSON.stringify({ ...validReply, evaluation: { strengths: many, gaps: many, suggestions: many } }),
    );
    expect(parsed?.evaluation.strengths).toHaveLength(4);
  });
});

describe('fallbackProfile (no LLM)', () => {
  it('builds role, grade and skills from the words of a frontend resume', () => {
    const profile = fallbackProfile(
      'Senior Frontend Developer. React, TypeScript, Redux, React, Next.js. Built web apps with React and GraphQL.',
    );
    expect(profile.role).toBe('Frontend Developer');
    expect(profile.grade).toBe('senior');
    expect(profile.skills[0]).toEqual({ name: 'React', weight: 'core' });
    expect(profile.skills.map((s) => s.name)).toEqual(
      expect.arrayContaining(['TypeScript', 'Redux', 'Next.js', 'GraphQL']),
    );
  });

  it('returns an empty profile for an empty resume rather than guessing', () => {
    expect(fallbackProfile('')).toEqual({ role: null, grade: null, skills: [] });
  });
});

describe('helpers', () => {
  it('dedupes skills case-insensitively, keeping the first', () => {
    expect(
      dedupeSkills([
        { name: 'Vue', weight: 'core' },
        { name: 'vue', weight: 'familiar' },
      ]),
    ).toEqual([{ name: 'Vue', weight: 'core' }]);
  });

  it('writes dictionary terms the way people write them', () => {
    expect(displaySkill('next.js')).toBe('Next.js');
    expect(displaySkill('jest')).toBe('Jest');
  });
});

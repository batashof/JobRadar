import {
  ANALYSIS_PROMPT_VERSION,
  buildAnalysisPrompt,
  dedupeSkills,
  displaySkill,
  fallbackProfile,
  parseAnalysis,
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
    expect(ANALYSIS_PROMPT_VERSION).toBeGreaterThanOrEqual(1);
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

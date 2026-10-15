import { evaluationMessage, parseSkillsInput, pickerKeyboard, profileCard } from './render';

const profile = {
  role: 'Frontend <Dev>',
  grade: 'senior',
  years: 8,
  skills: [
    { name: 'React', weight: 'core' as const },
    { name: 'Vue', weight: 'familiar' as const },
  ],
  english: null,
  location: 'Minsk',
  salaryUsd: null,
};

describe('profileCard', () => {
  it('lists the fields, escapes user text and marks what is unknown', () => {
    const { text } = profileCard('ru', profile);
    expect(text).toContain('Роль: Frontend &lt;Dev&gt;');
    expect(text).toContain('Грейд: Senior');
    expect(text).toContain('Опыт: 8 г.');
    expect(text).toContain('основные: React; ещё: Vue');
    expect(text).toContain('Английский: <i>не указано</i>');
  });

  it('offers confirm, edit and re-analysis buttons under the profile namespace', () => {
    const data = profileCard('en', profile).keyboard.flat().map((b) => b.callbackData);
    expect(data).toEqual(['p:ok', 'p:r', 'p:g', 'p:e', 'p:s', 'p:retry']);
  });

  it('warns when the profile came from the fallback, not the analysis', () => {
    expect(profileCard('en', profile, { fallback: true }).text).toContain('AI analysis is unavailable');
  });
});

describe('pickerKeyboard', () => {
  it('offers every grade plus a way back, within the 64-byte callback limit', () => {
    const buttons = pickerKeyboard('en', 'g').flat();
    expect(buttons.map((b) => b.callbackData)).toEqual([
      'p:g:intern',
      'p:g:junior',
      'p:g:middle',
      'p:g:senior',
      'p:g:lead',
      'p:card',
    ]);
    for (const field of ['g', 'e', 'r'] as const) {
      for (const b of pickerKeyboard('ru', field).flat()) {
        expect(Buffer.byteLength(b.callbackData ?? '')).toBeLessThanOrEqual(64);
      }
    }
  });
});

describe('evaluationMessage', () => {
  it('renders non-empty sections only, escaped', () => {
    const text = evaluationMessage('en', { strengths: ['Uses <Suspense>'], gaps: [], suggestions: ['Add tests'] });
    expect(text).toContain('• Uses &lt;Suspense&gt;');
    expect(text).not.toContain('Missing or weak');
    expect(text).toContain('What to add or rewrite');
  });
});

describe('parseSkillsInput', () => {
  it('splits on commas, semicolons and lines; first six are core', () => {
    const skills = parseSkillsInput('React, TypeScript; Next.js\nRedux, Jest, Cypress, GraphQL, CI/CD');
    expect(skills.map((s) => s.name)).toEqual([
      'React',
      'TypeScript',
      'Next.js',
      'Redux',
      'Jest',
      'Cypress',
      'GraphQL',
      'CI/CD',
    ]);
    expect(skills.filter((s) => s.weight === 'core')).toHaveLength(6);
  });

  it('drops bullets, blanks and duplicates', () => {
    expect(parseSkillsInput('- React\n• react\n,, Vue').map((s) => s.name)).toEqual(['React', 'Vue']);
    expect(parseSkillsInput(' , ; ')).toEqual([]);
  });
});

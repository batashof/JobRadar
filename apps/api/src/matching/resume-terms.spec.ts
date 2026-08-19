import {
  extractResumeTerms,
  LEX_MAX_RAW,
  normalizeLexScore,
  RESUME_STACK_LIMIT,
  ROLE_TITLE_WEIGHT,
  termsPattern,
} from './resume-terms';

const FRONTEND_RESUME = `
  Uladzislau Batashou — Senior Frontend Engineer
  8+ years building web applications with React, TypeScript and Next.js (SSR).
  Also: Redux, GraphQL, Jest, some Node.js on the side.
`;

describe('extractResumeTerms', () => {
  it('reads the job family and expands it to the words postings use', () => {
    const { roles } = extractResumeTerms(FRONTEND_RESUME);
    expect(roles).toContain('frontend');
    // The résumé never says "web developer", but a posting titled that is the
    // same job — the whole family counts once the résumé is centred on it.
    expect(roles).toContain('web developer');
    expect(roles).not.toContain('product manager');
  });

  it('ignores a family the résumé merely brushed against', () => {
    // The real thing: a frontend résumé mentioning DevOps in passing used to
    // rank the whole infrastructure vocabulary as its own, and DevOps postings
    // then took two thirds of the batch away from frontend ones.
    const { roles } = extractResumeTerms(`
      ${'Frontend engineer. '.repeat(5)} Worked closely with the DevOps team.
    `);
    expect(roles).toContain('frontend');
    expect(roles).not.toContain('devops');
  });

  it('keeps a second family the résumé genuinely splits between', () => {
    const { roles } = extractResumeTerms(
      'Fullstack engineer: frontend in React, backend in Node. Frontend and backend equally.',
    );
    expect(roles).toContain('frontend');
    expect(roles).toContain('backend');
  });

  it('takes the technologies actually mentioned, most-mentioned first', () => {
    const { stack } = extractResumeTerms(FRONTEND_RESUME);
    expect(stack).toContain('react');
    expect(stack).toContain('typescript');
    expect(stack).not.toContain('kubernetes');
  });

  it('caps the stack list so the tail of a long résumé cannot dilute it', () => {
    const everything = extractResumeTerms(
      'react vue angular svelte python java go rust php ruby scala kotlin swift docker aws',
    );
    expect(everything.stack).toHaveLength(RESUME_STACK_LIMIT);
  });

  it('matches at word boundaries — "go" is a language, "google" is not', () => {
    expect(extractResumeTerms('Worked at Google on ads').stack).not.toContain('go');
    expect(extractResumeTerms('Backend services in Go').stack).toContain('go');
  });

  it('returns empty lists for an empty résumé rather than guessing', () => {
    expect(extractResumeTerms('')).toEqual({ roles: [], stack: [] });
    expect(extractResumeTerms('   ')).toEqual({ roles: [], stack: [] });
  });

  it('reads a Russian résumé too — both languages reach the same board', () => {
    expect(extractResumeTerms('Фронтенд-разработчик, React, TypeScript').roles).toContain(
      'frontend',
    );
  });
});

describe('termsPattern', () => {
  it('is null for no terms, so the caller can drop the clause entirely', () => {
    expect(termsPattern([])).toBeNull();
  });

  it('puts word boundaries around ordinary terms', () => {
    expect(termsPattern(['react'])).toBe('\\yreact\\y');
  });

  it('escapes regex punctuation instead of letting it act', () => {
    expect(termsPattern(['next.js'])).toBe('\\ynext\\.js\\y');
    expect(termsPattern(['c++'])).toContain('c\\+\\+');
  });

  it('only asks for a boundary on a side that has a word character', () => {
    // `\y` next to `+` would match nothing at all: both sides are non-word.
    expect(termsPattern(['c++'])).toBe('\\yc\\+\\+');
    expect(termsPattern(['.net'])).toBe('\\.net\\y');
  });

  it('joins terms into one alternation', () => {
    expect(termsPattern(['react', 'vue'])).toBe('\\yreact\\y|\\yvue\\y');
  });
});

describe('normalizeLexScore', () => {
  it('brings the raw sum onto the 0..1 scale the other signals use', () => {
    expect(normalizeLexScore(LEX_MAX_RAW)).toBe(1);
    expect(normalizeLexScore(ROLE_TITLE_WEIGHT)).toBeCloseTo(ROLE_TITLE_WEIGHT / LEX_MAX_RAW);
  });

  it('treats a missing or unusable value as no signal', () => {
    expect(normalizeLexScore(null)).toBe(0);
    expect(normalizeLexScore(undefined)).toBe(0);
    expect(normalizeLexScore('nonsense')).toBe(0);
    expect(normalizeLexScore(-3)).toBe(0);
  });

  it('reads the numeric string Postgres returns for a computed column', () => {
    expect(normalizeLexScore('6')).toBe(1);
  });

  it('never exceeds 1, whatever the weights add up to', () => {
    expect(normalizeLexScore(LEX_MAX_RAW * 3)).toBe(1);
  });
});

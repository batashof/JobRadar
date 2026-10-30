import { EMPTY_FEEDBACK, TITLE_TERMS, titleFamilies, buildTitleFamilies } from '../matching/score';
import { decide } from './decide';
import { applyTermFixes, findIssues, proposeTermFixes, type TitleCase } from './findings';
import { FRONTEND, judgedPair, vacancy } from './fixtures';

const now = new Date('2026-10-30T12:00:00Z');
const prefs = { workFormats: ['remote' as const], employmentTypes: [], minSalaryUsd: null, locations: [], workLanguages: [] };
const input = { profile: FRONTEND, weights: EMPTY_FEEDBACK, prefs, minScore: 60, now };
const REACT = 'We build with React, TypeScript, Next.js and Redux.';
const CASES: TitleCase[] = [
  { title: 'Product Designer', families: ['design'] },
  { title: 'Senior Frontend Developer', families: ['frontend'] },
];

function one(title: string, description = REACT, extra = {}) {
  return decide(input, [vacancy(title, title, description, extra)])[0]!;
}

describe('findIssues', () => {
  it('flags a delivered non-engineering title', () => {
    const d = one('Growth Hacker');
    expect(d.delivered).toBe(true);
    const [f] = findIssues('frontend', [judgedPair(d, { engineering: false, family: 'marketing', fit: 5 })]);
    expect(f).toMatchObject({ kind: 'false-positive', cause: 'non-engineering-title' });
  });

  it('calls a fullstack role for a frontend profile a rule question', () => {
    const d = one('Full-Stack Engineer', `${REACT} Node.js and PostgreSQL on the backend.`);
    expect(d.delivered).toBe(true);
    const [f] = findIssues('frontend', [judgedPair(d, { family: 'fullstack', fit: 30 })]);
    expect(f!.cause).toBe('fullstack-policy');
  });

  it('flags a family drop the judge calls a fit, and ignores the user filters', () => {
    const dropped = one('Senior SEO Specialist');
    const filtered = one('Senior Frontend Developer', REACT, { workFormat: 'onsite' });
    const found = findIssues('frontend', [judgedPair(dropped, { fit: 85 }), judgedPair(filtered, { fit: 95 })]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'false-negative', cause: 'family' });
  });

  it('says nothing when the judge agrees', () => {
    expect(findIssues('frontend', [judgedPair(one('Senior Frontend Developer'), { fit: 90 })])).toEqual([]);
  });
});

describe('proposeTermFixes', () => {
  const fp = (title: string, keyword: string | null, family = 'marketing') => {
    const pair = judgedPair(one(title), { engineering: false, family: family as never, fit: 5, titleKeyword: keyword });
    return { pair, findings: findIssues('frontend', [pair]) };
  };

  it('proposes the title word for its family', () => {
    const { pair, findings } = fp('Growth Hacker', 'growth hacker');
    const { fixes, rejected } = proposeTermFixes(findings, TITLE_TERMS, CASES, [pair]);
    expect(rejected).toEqual([]);
    expect(fixes).toEqual([{ family: 'marketing', term: 'growth hacker', titles: ['Growth Hacker'] }]);
  });

  it('rejects a word that is not in the title, a technology, or an unknown family', () => {
    const cases = [
      fp('Growth Hacker', 'seo specialist'),
      fp('React Growth Hacker', 'react'),
      fp('Growth Hacker', 'hacker', 'legal'),
    ];
    const reasons = cases.map(({ pair, findings }) => proposeTermFixes(findings, TITLE_TERMS, CASES, [pair]).rejected[0]?.why);
    expect(reasons).toEqual([
      'not in the title as written',
      'an engineering word or a technology',
      'not a known non-engineering family',
    ]);
  });

  it('rejects a word that changes a regression case', () => {
    const { pair, findings } = fp('Webflow Specialist', 'specialist');
    expect(pair.decision.delivered).toBe(true);
    const cases = [...CASES, { title: 'Senior SEO Specialist', families: ['seo'] }];
    const { fixes, rejected } = proposeTermFixes(findings, TITLE_TERMS, cases, [pair]);
    expect(fixes).toEqual([]);
    expect(rejected[0]!.why).toBe('changes the regression case "Senior SEO Specialist"');
  });

  it('rejects a word that would stop an engineering title of the day', () => {
    const { pair, findings } = fp('Lead Generation Specialist', 'lead');
    const engineering = judgedPair(one('Lead Frontend'), { engineering: true, fit: 90 });
    const { fixes, rejected } = proposeTermFixes(findings, TITLE_TERMS, CASES, [pair, engineering]);
    expect(fixes).toEqual([]);
    expect(rejected[0]!.why).toBe('would also stop the engineering job "Lead Frontend"');
  });
});

describe('applyTermFixes', () => {
  it('adds the word and a regression case for the fixed title', () => {
    const next = applyTermFixes(TITLE_TERMS, CASES, [{ family: 'marketing', term: 'growth hacker', titles: ['Growth Hacker'] }]);
    expect(next.terms.nonEngineering.marketing).toContain('growth hacker');
    expect(TITLE_TERMS.nonEngineering.marketing).not.toContain('growth hacker');
    expect(next.cases.at(-1)).toEqual({ title: 'Growth Hacker', families: ['marketing'] });
    expect([...titleFamilies('Growth Hacker', buildTitleFamilies(next.terms))]).toEqual(['marketing']);
  });
});

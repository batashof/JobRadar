import { EMPTY_FEEDBACK } from '../matching/score';
import { decide } from './decide';
import { findIssues } from './findings';
import { FRONTEND, judgedPair, vacancy } from './fixtures';
import { type AuditSummary, deliveredPrecision, renderPrBody, renderReport, renderTelegram } from './report';

const now = new Date('2026-10-30T12:00:00Z');
const prefs = { workFormats: [], employmentTypes: [], minSalaryUsd: null, locations: [], workLanguages: [] };
const REACT = 'We build with React, TypeScript, Next.js and Redux.';

function summary(): AuditSummary {
  const decisions = decide({ profile: FRONTEND, weights: EMPTY_FEEDBACK, prefs, minScore: 60, now }, [
    vacancy('1', 'Senior Frontend Developer', REACT),
    vacancy('2', 'Growth Hacker', REACT),
    vacancy('3', 'Senior SEO Specialist', REACT),
  ]);
  const judged = [
    judgedPair(decisions[0]!, { fit: 90 }),
    judgedPair(decisions[1]!, { engineering: false, family: 'marketing', fit: 5, reason: 'A | marketing job' }),
  ];
  return {
    hours: 24,
    decisions,
    judged,
    unjudged: 1,
    providers: ['github-models'],
    findings: findIssues('frontend', judged),
    fixes: [{ family: 'marketing', term: 'growth hacker', titles: ['Growth Hacker'] }],
    rejected: [],
    runUrl: 'https://github.com/o/r/actions/runs/1',
  };
}

describe('audit report', () => {
  it('measures the precision of deliveries', () => {
    expect(deliveredPrecision(summary())).toBe(0.5);
    expect(deliveredPrecision({ judged: [] })).toBeNull();
  });

  it('renders the markdown report with counts, findings and fixes', () => {
    const report = renderReport(summary());
    expect(report).toContain('Vacancies: **3**, the formula delivers **2**');
    expect(report).toContain('**50%** rated ≥40');
    expect(report).toContain('- another job family: 1');
    expect(report).toContain('[Growth Hacker](https://example.com/2)');
    expect(report).toContain('A \\| marketing job');
    expect(report).toContain('`growth hacker` → marketing');
  });

  it('renders the Telegram summary in Russian with the run link', () => {
    const text = renderTelegram(summary());
    expect(text).toContain('Лишние: 1, пропущенные: 0');
    expect(text).toContain('Слова в словарь: growth hacker → marketing');
    expect(text).toContain('Отчёт: https://github.com/o/r/actions/runs/1');
  });

  it('renders the pull request body', () => {
    expect(renderPrBody(summary())).toContain('- `growth hacker` → `marketing`: Growth Hacker');
  });
});

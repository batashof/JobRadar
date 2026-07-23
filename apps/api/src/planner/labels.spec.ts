import { plannerLabel } from './labels';

describe('planner labels', () => {
  it('renders candidate titles in the account language (ADR-014)', () => {
    expect(plannerLabel('en', 'followup.title', { company: 'Acme' })).toBe('Follow up: Acme');
    expect(plannerLabel('ru', 'followup.title', { company: 'Acme' })).toBe(
      'Напомнить о себе: Acme',
    );
  });

  it('interpolates every placeholder', () => {
    expect(plannerLabel('en', 'followup.reason', { days: 9, stage: 'applied' })).toBe(
      'No answer for 9 days (applied)',
    );
    expect(plannerLabel('ru', 'debt.reason', { date: '2026-07-22', count: 3 })).toBe(
      'Не сделано с 2026-07-22 — переносится 3×',
    );
  });

  it('leaves an unknown placeholder visible rather than printing "undefined"', () => {
    expect(plannerLabel('en', 'apply.reason', {})).toBe('Matches your profile ({score}%)');
  });
});

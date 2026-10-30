import { type Decision, type DropReason } from './decide';
import { type Cause, FIT_BAD, FIT_GOOD, type Finding, type RejectedFix, type TermFix } from './findings';
import { type Verdict } from './judge';

/** Everything one audit run found, as the report and the Telegram summary show it. */
export interface AuditSummary {
  hours: number;
  decisions: Decision[];
  judged: { decision: Decision; verdict: Verdict }[];
  /** Vacancies the budget or a failed provider left unjudged. */
  unjudged: number;
  providers: string[];
  findings: Finding[];
  fixes: TermFix[];
  rejected: RejectedFix[];
  runUrl?: string;
}

const CAUSE_LABEL: Record<Cause, string> = {
  'non-engineering-title': 'not an engineering job',
  'fullstack-policy': 'fullstack for a frontend profile (rule, your call)',
  'stack-policy': 'backend stack not in the profile (rule, ADR-036)',
  family: 'another job family',
  language: 'working language misread',
  grade: 'grade gate',
  skills: 'skill overlap',
};

const REASON_LABEL: Record<DropReason, string> = {
  location: 'location filter',
  'work-format': 'work-format filter',
  employment: 'employment filter',
  salary: 'salary filter',
  language: 'language filter',
  'too-junior': 'too junior',
  'wrong-family': 'another job family',
  'foreign-stack': 'backend stack not in the profile',
  'far-grade': 'grade too far',
  'below-floor': 'below the min fit',
};

/** Share of judged deliveries the judge rates a fit, 0..1; null with none judged. */
export function deliveredPrecision(summary: Pick<AuditSummary, 'judged'>): number | null {
  const delivered = summary.judged.filter((j) => j.decision.delivered);
  if (delivered.length === 0) return null;
  return delivered.filter((j) => j.verdict.fit >= FIT_BAD).length / delivered.length;
}

function countBy<T>(items: T[], key: (item: T) => string): [string, number][] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

function findingRow(f: Finding): string {
  const v = f.decision.vacancy;
  return `| [${cell(v.title).slice(0, 70)}](${v.url}) | ${v.sourceSlug ?? '-'} | ${f.decision.score} | ${f.verdict.fit} | ${CAUSE_LABEL[f.cause]} | ${cell(f.verdict.reason).slice(0, 120)} |`;
}

export function renderReport(summary: AuditSummary): string {
  const delivered = summary.decisions.filter((d) => d.delivered).length;
  const precision = deliveredPrecision(summary);
  const fps = summary.findings.filter((f) => f.kind === 'false-positive');
  const fns = summary.findings.filter((f) => f.kind === 'false-negative');
  const lines: string[] = [
    `# Delivery quality audit — last ${summary.hours} h`,
    '',
    `- Vacancies: **${summary.decisions.length}**, the formula delivers **${delivered}**.`,
    `- Judged by the LLM: ${summary.judged.length} (${summary.providers.join(', ') || 'no provider answered'}); unjudged: ${summary.unjudged}.`,
    `- Precision of deliveries: ${precision === null ? 'n/a' : `**${Math.round(precision * 100)}%** rated ≥${FIT_BAD}`}.`,
    `- Sent but not a fit: **${fps.length}**; held back but a fit (≥${FIT_GOOD}): **${fns.length}**.`,
    `- Dictionary fixes: **${summary.fixes.length}**${summary.rejected.length ? `, rejected words: ${summary.rejected.length}` : ''}.`,
    '',
    '## Why vacancies were dropped',
    '',
    ...countBy(
      summary.decisions.filter((d) => d.reason),
      (d) => REASON_LABEL[d.reason!],
    ).map(([label, n]) => `- ${label}: ${n}`),
  ];

  const table = (title: string, items: Finding[]) => {
    if (items.length === 0) return;
    lines.push('', `## ${title}`, '');
    for (const [cause, n] of countBy(items, (f) => CAUSE_LABEL[f.cause])) lines.push(`- ${cause}: ${n}`);
    lines.push('', '| Vacancy | Source | Formula | LLM | Cause | Judge says |', '|---|---|---|---|---|---|');
    lines.push(...items.slice(0, 40).map(findingRow));
    if (items.length > 40) lines.push(``, `…and ${items.length - 40} more.`);
  };
  table('Sent but not a fit (false positives)', fps);
  table('Held back but a fit (false negatives)', fns);

  if (summary.fixes.length > 0) {
    lines.push('', '## Dictionary fixes', '');
    for (const fix of summary.fixes) {
      lines.push(`- \`${fix.term}\` → ${fix.family}: ${fix.titles.slice(0, 3).map(cell).join('; ')}`);
    }
  }
  if (summary.rejected.length > 0) {
    lines.push('', '## Words not added', '');
    for (const r of summary.rejected) lines.push(`- \`${r.term}\` (${r.family}): ${r.why}`);
  }
  return `${lines.join('\n')}\n`;
}

/** The short version for the author's Telegram chat; plain text. */
export function renderTelegram(summary: AuditSummary): string {
  const delivered = summary.decisions.filter((d) => d.delivered).length;
  const precision = deliveredPrecision(summary);
  const fps = summary.findings.filter((f) => f.kind === 'false-positive');
  const fns = summary.findings.filter((f) => f.kind === 'false-negative');
  const lines = [
    `🔎 Аудит выдачи за ${summary.hours} ч`,
    `Вакансий: ${summary.decisions.length}, формула отправила бы: ${delivered}, проверено LLM: ${summary.judged.length}`,
    `Точность отправленного: ${precision === null ? 'н/д' : `${Math.round(precision * 100)}%`}`,
    `Лишние: ${fps.length}, пропущенные: ${fns.length}`,
  ];
  const policy = fps.filter((f) => f.cause === 'fullstack-policy').length;
  if (policy > 0) lines.push(`Фулстек для фронтенд-профиля: ${policy} (правило, решение за вами)`);
  if (summary.fixes.length > 0) {
    lines.push(`Слова в словарь: ${summary.fixes.map((f) => `${f.term} → ${f.family}`).join(', ')}`);
  }
  if (summary.runUrl) lines.push(`Отчёт: ${summary.runUrl}`);
  return lines.join('\n');
}

/** The body of the audit's pull request. */
export function renderPrBody(summary: AuditSummary): string {
  return [
    'Dictionary fixes from the daily delivery quality audit (ADR-035).',
    '',
    ...summary.fixes.map(
      (fix) => `- \`${fix.term}\` → \`${fix.family}\`: ${fix.titles.slice(0, 3).map(cell).join('; ')}`,
    ),
    '',
    'Each word was proposed by the LLM judge, checked by code (in the title, not a technology, no regression case or engineering title of the day changes) and added to `title-cases.json` with the title it fixes. Build, lint, typecheck and tests passed in the audit job.',
    summary.runUrl ? `\nAudit run: ${summary.runUrl}` : '',
  ].join('\n');
}

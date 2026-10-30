import {
  buildTitleFamilies,
  detectVacancySkills,
  hasEngineeringWord,
  phrasePattern,
  titleFamilies,
  type TitleTerms,
} from '../matching/score';
import { type Decision, USER_FILTER_REASONS } from './decide';
import { type Verdict } from './judge';

/**
 * What the judge's verdicts say about the formula's decisions (ADR-035), and
 * the dictionary words that would fix the clear cases.
 */

/** A delivered vacancy the judge rates below this was noise. */
export const FIT_BAD = 40;
/** A dropped vacancy the judge rates at or above this was a miss. */
export const FIT_GOOD = 70;

export type Cause =
  /** The title is not an engineering job; a dictionary word can fix it. */
  | 'non-engineering-title'
  /** A fullstack role sent to a frontend candidate: a rule, the developer decides. */
  | 'fullstack-policy'
  /** The judge reads another job family than the formula. */
  | 'family'
  /** The working-language reading dropped a vacancy the judge thinks is fine. */
  | 'language'
  /** The level gate or the far-grade cap. */
  | 'grade'
  /** The skill overlap carried it, or held it back. */
  | 'skills';

export interface Finding {
  kind: 'false-positive' | 'false-negative';
  cause: Cause;
  decision: Decision;
  verdict: Verdict;
}

export function findIssues(
  candidateFamily: string | null,
  judged: { decision: Decision; verdict: Verdict }[],
): Finding[] {
  const found: Finding[] = [];
  for (const { decision, verdict } of judged) {
    if (decision.delivered && verdict.fit < FIT_BAD) {
      found.push({ kind: 'false-positive', cause: falsePositiveCause(candidateFamily, decision, verdict), decision, verdict });
    } else if (!decision.delivered && verdict.fit >= FIT_GOOD && decision.reason && !USER_FILTER_REASONS.has(decision.reason)) {
      found.push({ kind: 'false-negative', cause: falseNegativeCause(decision), decision, verdict });
    }
  }
  return found;
}

function falsePositiveCause(candidateFamily: string | null, decision: Decision, verdict: Verdict): Cause {
  if (!verdict.engineering) return 'non-engineering-title';
  if (
    candidateFamily === 'frontend' &&
    (verdict.family === 'fullstack' || decision.titleFamilies.includes('fullstack'))
  ) {
    return 'fullstack-policy';
  }
  if (candidateFamily && verdict.family !== candidateFamily && verdict.family !== 'other') return 'family';
  return 'skills';
}

function falseNegativeCause(decision: Decision): Cause {
  switch (decision.reason) {
    case 'language':
      return 'language';
    case 'too-junior':
    case 'far-grade':
      return 'grade';
    case 'wrong-family':
      return 'family';
    default:
      return 'skills';
  }
}

// ---------------------------------------------------------------------------
// Dictionary fixes
// ---------------------------------------------------------------------------

export interface TitleCase {
  title: string;
  families: string[];
}

export interface TermFix {
  family: string;
  term: string;
  /** Delivered titles the word stops. */
  titles: string[];
}

export interface RejectedFix {
  family: string;
  term: string;
  why: string;
}

const sameFamilies = (a: string[], b: string[]): boolean =>
  a.length === b.length && [...a].sort().every((value, i) => value === [...b].sort()[i]);

/**
 * Words to add to a non-engineering family of `title-terms.json`, from the
 * delivered vacancies the judge says are not engineering jobs. A word is
 * proposed only when every check passes:
 *   - the judge named an existing non-engineering family (a new family is a
 *     decision for the developer, reported only);
 *   - the word is in the title as written, is not an engineering word and not
 *     a technology;
 *   - with it, the title is read as that family;
 *   - no case of the regression set changes;
 *   - no title of the day that the judge calls engineering changes.
 */
export function proposeTermFixes(
  findings: Finding[],
  terms: TitleTerms,
  cases: TitleCase[],
  judged: { decision: Decision; verdict: Verdict }[],
): { fixes: TermFix[]; rejected: RejectedFix[] } {
  const grouped = new Map<string, TermFix>();
  const rejected: RejectedFix[] = [];
  const reject = (family: string, term: string, why: string) => {
    if (!rejected.some((r) => r.family === family && r.term === term)) rejected.push({ family, term, why });
  };

  for (const finding of findings) {
    if (finding.cause !== 'non-engineering-title') continue;
    const { family, titleKeyword: term } = finding.verdict;
    const title = finding.decision.vacancy.title;
    if (!term) continue;
    if (!(family in terms.nonEngineering)) {
      reject(family, term, 'not a known non-engineering family');
      continue;
    }
    if (term.length < 2 || term.length > 40) {
      reject(family, term, 'too short or too long');
      continue;
    }
    if (!phrasePattern(term).test(title.toLowerCase())) {
      reject(family, term, 'not in the title as written');
      continue;
    }
    if (hasEngineeringWord(term) || detectVacancySkills(term, '').length > 0) {
      reject(family, term, 'an engineering word or a technology');
      continue;
    }
    const key = `${family}\u0000${term}`;
    const existing = grouped.get(key);
    if (existing) {
      if (titleFamilies(title, buildTitleFamilies(withTerm(terms, family, term))).has(family)) {
        existing.titles.push(title);
      }
      continue;
    }
    if (terms.nonEngineering[family]!.includes(term)) continue;

    const next = withTerm(terms, family, term);
    const families = buildTitleFamilies(next);
    if (!titleFamilies(title, families).has(family)) {
      reject(family, term, 'the title still does not read as that family');
      continue;
    }
    const broken = cases.find((c) => !sameFamilies([...titleFamilies(c.title, families)], c.families));
    if (broken) {
      reject(family, term, `changes the regression case "${broken.title}"`);
      continue;
    }
    const collateral = judged.find(
      ({ decision, verdict }) => verdict.engineering && titleFamilies(decision.vacancy.title, families).has(family),
    );
    if (collateral) {
      reject(family, term, `would also stop the engineering job "${collateral.decision.vacancy.title}"`);
      continue;
    }
    grouped.set(key, { family, term, titles: [title] });
  }

  // Two words for one title are one fix too many; keep the first.
  const fixes: TermFix[] = [];
  const covered = new Set<string>();
  for (const fix of grouped.values()) {
    if (fix.titles.every((title) => covered.has(title))) continue;
    fix.titles.forEach((title) => covered.add(title));
    fixes.push(fix);
  }
  return { fixes, rejected };
}

function withTerm(terms: TitleTerms, family: string, term: string): TitleTerms {
  return {
    titleOnly: terms.titleOnly,
    nonEngineering: { ...terms.nonEngineering, [family]: [...terms.nonEngineering[family]!, term] },
  };
}

/** The dictionary and the regression set with the fixes in, one case per fixed title. */
export function applyTermFixes(
  terms: TitleTerms,
  cases: TitleCase[],
  fixes: TermFix[],
): { terms: TitleTerms; cases: TitleCase[] } {
  let next = terms;
  for (const fix of fixes) next = withTerm(next, fix.family, fix.term);
  const families = buildTitleFamilies(next);
  const known = new Set(cases.map((c) => c.title.toLowerCase()));
  const added: TitleCase[] = [];
  for (const title of fixes.flatMap((fix) => fix.titles)) {
    if (known.has(title.toLowerCase())) continue;
    known.add(title.toLowerCase());
    added.push({ title, families: [...titleFamilies(title, families)].sort() });
  }
  return { terms: next, cases: [...cases, ...added] };
}

import { titleSimilarity } from './title-similarity';

/** Candidate vacancy shape for dedup (canonical_vacancy_id IS NULL rows only). */
export interface DedupCandidate {
  id: string;
  companyNormalized: string;
  title: string;
  publishedAt: Date | null;
  ingestedAt: Date;
}

export interface DuplicateLink {
  duplicateId: string;
  canonicalId: string;
}

export interface DedupOptions {
  /** Max |published| gap between duplicates, in days (DATA_MODEL.md: 14). */
  windowDays: number;
  /** Min title similarity in [0,1] (DATA_MODEL.md: tune on real data). */
  threshold: number;
}

/** Companies whose normalized name carries no identity — never matched. */
const UNMATCHABLE_COMPANIES = new Set(['', 'unknown']);

const effectiveDate = (c: DedupCandidate): number =>
  (c.publishedAt ?? c.ingestedAt).getTime();

/**
 * ADR-004 heuristic: within the same normalized company, a vacancy duplicates
 * an earlier-ingested one when titles are similar enough and publication dates
 * fall within the window. The earliest-ingested vacancy stays canonical; chains
 * are compressed (a duplicate of a duplicate links to the root canonical).
 */
export function pickDuplicateLinks(
  candidates: DedupCandidate[],
  { windowDays, threshold }: DedupOptions,
): DuplicateLink[] {
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const links: DuplicateLink[] = [];
  const canonicalOf = new Map<string, string>();

  const byCompany = new Map<string, DedupCandidate[]>();
  for (const candidate of candidates) {
    if (UNMATCHABLE_COMPANIES.has(candidate.companyNormalized)) continue;
    const group = byCompany.get(candidate.companyNormalized) ?? [];
    group.push(candidate);
    byCompany.set(candidate.companyNormalized, group);
  }

  for (const group of byCompany.values()) {
    group.sort((a, b) => a.ingestedAt.getTime() - b.ingestedAt.getTime());

    for (let i = 1; i < group.length; i++) {
      const later = group[i]!;
      for (let j = 0; j < i; j++) {
        const earlier = group[j]!;
        if (canonicalOf.has(earlier.id)) continue; // link only to canonical roots
        if (Math.abs(effectiveDate(later) - effectiveDate(earlier)) > windowMs) continue;
        if (titleSimilarity(later.title, earlier.title) < threshold) continue;

        links.push({ duplicateId: later.id, canonicalId: earlier.id });
        canonicalOf.set(later.id, earlier.id);
        break;
      }
    }
  }

  return links;
}

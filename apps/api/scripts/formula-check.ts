/**
 * ADR-025 §9 quality gate: on the author's resume, does the formula's top 20
 * overlap the LLM's top 20 (cached in `resume_matches`) by at least 70%?
 * Read-only. Prints the overlap and both top lists side by side.
 *
 * The owner's candidate profile is used when one exists (uploaded in the bot);
 * otherwise the same term fallback a failed analysis gets (ADR-025 §3).
 * Freshness is neutralized — the LLM never saw publication dates, so they
 * would only measure a difference the gate is not about.
 *
 * Run with: pnpm --filter @jobradar/api formula:check [--prod]
 */
import { type SeniorityLevel } from '@jobradar/shared';
import { config } from 'dotenv';
import { and, desc, eq, sql } from 'drizzle-orm';

import { fallbackProfile } from '../src/candidate/analysis';
import { openScriptDb } from '../src/db/prod-db';
import { candidateProfiles, resumeMatches, resumes, users, vacancies } from '../src/db/schema';
import {
  compareRankings,
  FORMULA_CHECK_GOOD_FIT,
  FORMULA_CHECK_TOP_N,
} from '../src/matching/formula-check';
import { type ScoringProfile, scoreVacancy } from '../src/matching/score';

config({ path: '../../.env' });

async function main(): Promise<void> {
  const prod = process.argv.includes('--prod');
  const { db, close } = openScriptDb(prod);
  try {
    // Every account older than the bot became an owner (migration 0019), test
    // accounts included; the author is the owner whose active resume carries
    // the most LLM scores.
    const [resume] = await db
      .select({
        id: resumes.id,
        userId: resumes.userId,
        text: resumes.extractedText,
        scored: sql<number>`count(${resumeMatches.vacancyId})::int`,
      })
      .from(resumes)
      .innerJoin(users, eq(users.id, resumes.userId))
      .leftJoin(resumeMatches, eq(resumeMatches.resumeId, resumes.id))
      .where(and(eq(users.role, 'owner'), eq(resumes.isActive, true)))
      .groupBy(resumes.id)
      .orderBy(desc(sql`count(${resumeMatches.vacancyId})`))
      .limit(1);
    if (!resume) throw new Error('no owner has an active resume');
    const owner = { id: resume.userId };

    const [stored] = await db
      .select({ role: candidateProfiles.role, grade: candidateProfiles.grade, skills: candidateProfiles.skills })
      .from(candidateProfiles)
      .where(eq(candidateProfiles.userId, owner.id));
    const profile: ScoringProfile = stored
      ? { role: stored.role, grade: stored.grade as SeniorityLevel | null, skills: stored.skills }
      : fallbackProfile(resume.text);
    console.log(`Profile: ${stored ? 'candidate_profiles' : 'resume-term fallback'}`);
    console.log(`  role=${profile.role ?? '-'} grade=${profile.grade ?? '-'}`);
    console.log(`  skills=${profile.skills.map((s) => `${s.name}${s.weight === 'core' ? '*' : ''}`).join(', ')}`);

    const rows = await db
      .select({
        vacancyId: resumeMatches.vacancyId,
        llmScore: resumeMatches.score,
        title: vacancies.title,
        company: vacancies.companyRaw,
        description: vacancies.description,
        seniority: vacancies.seniority,
      })
      .from(resumeMatches)
      .innerJoin(vacancies, eq(vacancies.id, resumeMatches.vacancyId))
      .where(eq(resumeMatches.resumeId, resume.id));

    const now = new Date();
    const pairs = rows.map((row) => ({
      ...row,
      formulaScore: scoreVacancy(profile, { ...row, publishedAt: now }, { now }).score,
    }));
    const result = compareRankings(pairs);

    console.log(`\nScored pairs: ${pairs.length}`);
    console.log(
      `Top ${FORMULA_CHECK_TOP_N} overlap: ${result.shared}/${result.size} = ${Math.round(result.overlap * 100)}% → ${
        result.pass ? 'PASS' : 'FAIL'
      } (needs ≥70%)`,
    );
    console.log(
      `Precision: ${Math.round(result.precision * 100)}% of the formula's top ${FORMULA_CHECK_TOP_N} scored ≥${Math.round(
        FORMULA_CHECK_GOOD_FIT * 100,
      )} by the LLM`,
    );

    const byLlm = [...pairs].sort((a, b) => b.llmScore - a.llmScore).slice(0, FORMULA_CHECK_TOP_N);
    const byFormula = [...pairs].sort((a, b) => b.formulaScore - a.formulaScore).slice(0, FORMULA_CHECK_TOP_N);
    console.log('\n#  | LLM top                                      | formula top');
    for (let i = 0; i < FORMULA_CHECK_TOP_N; i += 1) {
      const l = byLlm[i];
      const f = byFormula[i];
      const left = l ? `${Math.round(l.llmScore * 100)} ${l.title}`.slice(0, 44).padEnd(44) : ''.padEnd(44);
      const right = f ? `${f.formulaScore} ${f.title}`.slice(0, 50) : '';
      console.log(`${String(i + 1).padStart(2)} | ${left} | ${right}`);
    }
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

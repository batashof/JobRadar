import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ResumeMatchRunResult } from '@jobradar/shared';
import { and, desc, eq, isNull, notExists, sql } from 'drizzle-orm';

import { DB, type Database } from '../db/db.module';
import { profileMatches, resumeMatches, resumes, searchProfiles, vacancies } from '../db/schema';
import { LlmService } from '../llm/llm.service';
import { buildResumeMatchPrompt, parseResumeMatchReply } from './resume-match';

/**
 * LLM resume ↔ vacancy scoring (ADR-011). Token discipline (ADR-005):
 * - only vacancies that already pass rules-based profile matching are scored;
 * - results are permanent (`resume_matches`) — one LLM call per resume × vacancy;
 * - each run is capped, newest vacancies first; the rest wait for future runs.
 */
const DEFAULT_RUN_LIMIT = 10;

@Injectable()
export class ResumeMatchingService {
  private readonly logger = new Logger(ResumeMatchingService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly llm: LlmService,
  ) {}

  /** Scores up to `limit` pending vacancies per active resume. */
  async scorePending(limit = DEFAULT_RUN_LIMIT, userId?: string): Promise<ResumeMatchRunResult> {
    if (!this.llm.isConfigured()) {
      this.logger.log('resume matching skipped: no LLM provider configured');
      return { scored: 0, remaining: 0 };
    }

    const activeResumes = await this.db
      .select({ id: resumes.id, userId: resumes.userId, text: resumes.extractedText })
      .from(resumes)
      .where(
        userId
          ? and(eq(resumes.isActive, true), eq(resumes.userId, userId))
          : eq(resumes.isActive, true),
      );

    let scored = 0;
    let remaining = 0;
    for (const resume of activeResumes) {
      if (!resume.text) continue;
      const result = await this.scoreForResume(resume, limit);
      scored += result.scored;
      remaining += result.remaining;
    }
    if (scored || remaining) {
      this.logger.log(`resume matching: scored ${scored}, remaining ${remaining}`);
    }
    return { scored, remaining };
  }

  private async scoreForResume(
    resume: { id: string; userId: string; text: string },
    limit: number,
  ): Promise<ResumeMatchRunResult> {
    // Candidates: canonical vacancies matched by the user's active profiles and
    // not yet scored against this resume, newest first.
    const candidates = await this.db
      .selectDistinctOn([vacancies.publishedAt, vacancies.id], {
        id: vacancies.id,
        title: vacancies.title,
        company: vacancies.companyRaw,
        description: vacancies.description,
      })
      .from(profileMatches)
      .innerJoin(searchProfiles, eq(searchProfiles.id, profileMatches.profileId))
      .innerJoin(vacancies, eq(vacancies.id, profileMatches.vacancyId))
      .where(
        and(
          eq(searchProfiles.userId, resume.userId),
          eq(searchProfiles.isActive, true),
          isNull(vacancies.canonicalVacancyId),
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(resumeMatches)
              .where(
                and(
                  eq(resumeMatches.resumeId, resume.id),
                  eq(resumeMatches.vacancyId, vacancies.id),
                ),
              ),
          ),
        ),
      )
      .orderBy(desc(vacancies.publishedAt), vacancies.id)
      .limit(limit + 50); // cheap overshoot to report a meaningful `remaining`

    const batch = candidates.slice(0, limit);
    let scored = 0;

    for (const vacancy of batch) {
      const prompt = buildResumeMatchPrompt(vacancy, resume.text);
      let reply: string;
      try {
        reply = (await this.llm.complete({ ...prompt, maxTokens: 300, temperature: 0.2 })).text;
      } catch (err) {
        // Providers exhausted — stop the run; unscored vacancies stay pending.
        this.logger.warn(`resume matching stopped early: ${String(err)}`);
        break;
      }
      const parsed = parseResumeMatchReply(reply);
      if (!parsed) {
        this.logger.warn(`unparseable resume-match reply for vacancy ${vacancy.id}`);
        continue; // retried on a future run
      }
      await this.db
        .insert(resumeMatches)
        .values({
          resumeId: resume.id,
          vacancyId: vacancy.id,
          score: parsed.score,
          explanation: parsed.explanation,
        })
        .onConflictDoNothing();
      scored += 1;
    }

    return { scored, remaining: candidates.length - scored };
  }
}

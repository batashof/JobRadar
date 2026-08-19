import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ResumeMatchRunResult } from '@jobradar/shared';
import { and, eq, gte, isNull, notExists, sql } from 'drizzle-orm';

import { DB, type Database } from '../db/db.module';
import { resumeMatches, resumes, vacancies } from '../db/schema';
import { LlmService } from '../llm/llm.service';
import { buildResumeMatchPrompt, parseResumeMatchReply } from './resume-match';
import { extractResumeTerms, lexicalRelevanceSql } from './resume-terms';

/**
 * LLM resume ↔ vacancy scoring (ADR-011). Token discipline (ADR-005):
 * - the most résumé-relevant unscored vacancies are scored first;
 * - results are permanent (`resume_matches`) — one LLM call per resume × vacancy;
 * - each run is capped; the rest wait for future runs.
 */
const DEFAULT_RUN_LIMIT = 10;

/**
 * How far back a vacancy stays worth an LLM call. A run can never catch up with
 * the whole board, and a two-month-old posting is usually closed — spending the
 * budget on what is still live is the better trade.
 */
const SCORING_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

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
    // Candidates: canonical vacancies not yet scored against this resume, the
    // most résumé-relevant first.
    //
    // This used to start from `profile_matches`, which made an active search
    // profile a hard gate — the same gate v1.19.1 removed from the digest, left
    // behind here. An account without a profile had every run score nothing, so
    // `resume_matches` stayed empty forever, and everything downstream that
    // ranks on that cached score silently had no signal to rank with.
    //
    // Relevance ordering is what makes the ungating affordable: a run is a
    // handful of LLM calls against a board of thousands of postings, and
    // "newest first" would spend them on whatever was posted last.
    const relevance = lexicalRelevanceSql(
      extractResumeTerms(resume.text),
      vacancies.title,
      vacancies.description,
    );

    const candidates = await this.db
      .select({
        id: vacancies.id,
        title: vacancies.title,
        company: vacancies.companyRaw,
        description: vacancies.description,
        location: vacancies.location,
      })
      .from(vacancies)
      .where(
        and(
          isNull(vacancies.canonicalVacancyId),
          gte(vacancies.ingestedAt, new Date(Date.now() - SCORING_WINDOW_DAYS * DAY_MS)),
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
      .orderBy(sql`${relevance} desc, ${vacancies.publishedAt} desc nulls last`)
      .limit(limit + 50); // cheap overshoot to report a meaningful `remaining`

    const batch = candidates.slice(0, limit);
    let scored = 0;

    for (const vacancy of batch) {
      const prompt = buildResumeMatchPrompt(vacancy, resume.text);
      let reply: string;
      try {
        reply = (await this.llm.complete({ ...prompt, maxTokens: 500, temperature: 0.2 })).text;
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
          // Batch runs in the default (Russian) language slot.
          breakdown: parsed.breakdown,
        })
        .onConflictDoNothing();
      scored += 1;
    }

    return { scored, remaining: candidates.length - scored };
  }
}

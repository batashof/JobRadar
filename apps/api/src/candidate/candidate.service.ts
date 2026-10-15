import { Inject, Injectable } from '@nestjs/common';
import {
  type CandidateProfileSource,
  type CandidateSkill,
  RESUME_ANALYSIS_WINDOW_DAYS,
  type ResumeEvaluation,
} from '@jobradar/shared';
import { and, eq, gt, sql } from 'drizzle-orm';

import { DB, type Database } from '../db/db.module';
import { candidateProfiles, events } from '../db/schema';

export type CandidateProfileRow = typeof candidateProfiles.$inferSelect;

export interface ProfileWrite {
  resumeId: string | null;
  source: CandidateProfileSource;
  promptVersion: number;
  role: string | null;
  grade: string | null;
  years: number | null;
  skills: CandidateSkill[];
  english: string | null;
  location: string | null;
  salaryUsd: number | null;
  evaluation: ResumeEvaluation | null;
}

/** Fields the confirmation dialog can change (ADR-025 §2). */
export type ProfilePatch = Partial<Pick<ProfileWrite, 'role' | 'grade' | 'english' | 'skills'>>;

/** Storage of the candidate profile: one row per user (`candidate_profiles`). */
@Injectable()
export class CandidateService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async get(userId: string): Promise<CandidateProfileRow | null> {
    const [row] = await this.db
      .select()
      .from(candidateProfiles)
      .where(eq(candidateProfiles.userId, userId));
    return row ?? null;
  }

  /** A new analysis replaces the profile and asks for confirmation again. */
  async replace(userId: string, profile: ProfileWrite, now: Date = new Date()): Promise<void> {
    const values = { ...profile, analyzedAt: now, confirmedAt: null, updatedAt: now };
    await this.db
      .insert(candidateProfiles)
      .values({ userId, ...values })
      .onConflictDoUpdate({ target: candidateProfiles.userId, set: values });
  }

  async update(userId: string, patch: ProfilePatch): Promise<void> {
    await this.db
      .update(candidateProfiles)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(candidateProfiles.userId, userId));
  }

  async confirm(userId: string, now: Date = new Date()): Promise<void> {
    await this.db
      .update(candidateProfiles)
      .set({ confirmedAt: now, updatedAt: now })
      .where(eq(candidateProfiles.userId, userId));
  }

  /**
   * LLM analyses this user ran in the rolling window (ADR-025 §3). Counted from
   * `events`, which outlive a re-upload; fallback runs cost no tokens and do
   * not count.
   */
  async analysesInWindow(userId: string, now: Date = new Date()): Promise<number> {
    const since = new Date(now.getTime() - RESUME_ANALYSIS_WINDOW_DAYS * 86_400_000);
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(events)
      .where(
        and(
          eq(events.userId, userId),
          eq(events.name, 'resume_analyzed'),
          gt(events.createdAt, since),
          sql`${events.props}->>'source' = 'llm'`,
        ),
      );
    return Number(row?.n ?? 0);
  }
}

import { Logger } from '@nestjs/common';
import { and, asc, count, eq, gte, inArray, lt, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import type { Database } from '../db/db.module';
import { reports } from '../db/schema';
import {
  errorFingerprint,
  feedbackTitle,
  type ReportStatus,
  TRANSIENT_FLOOR,
  type TriageExtras,
  type TriageItem,
} from './triage-logic';

/**
 * The bug and feedback inbox (ADR-037), database half. Shared by the bot and
 * the daily `scripts/triage.ts`, which opens its own connection.
 */

const logger = new Logger('Reports');

/** Statuses the owner can still change from Telegram; issued and done belong to GitHub. */
const OPEN_STATUSES: ReportStatus[] = ['new', 'fix', 'skip'];

/**
 * Counts one occurrence of an error. A fault that was fixed (`done`) and comes
 * back opens again as new, so a regression reaches the next digest. Best-effort.
 */
export async function recordErrorReport(
  db: Database,
  where: string,
  message: string,
  transient: boolean,
  now: Date = new Date(),
): Promise<void> {
  try {
    const reopened = sql`${reports.status} = 'done'`;
    await db
      .insert(reports)
      .values({
        kind: 'error',
        fingerprint: errorFingerprint(where, message),
        title: where.slice(0, 80),
        detail: message.slice(0, 1000),
        transient,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: reports.fingerprint,
        set: {
          count: sql`${reports.count} + 1`,
          detail: message.slice(0, 1000),
          transient,
          lastSeenAt: now,
          status: sql`case when ${reopened} then 'new' else ${reports.status} end`,
          issueNumber: sql`case when ${reopened} then null else ${reports.issueNumber} end`,
          digestedAt: sql`case when ${reopened} then null else ${reports.digestedAt} end`,
        },
      });
  } catch (err) {
    logger.warn(`error report not saved: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Keeps one /feedback text for triage; deleted with the account. Best-effort. */
export async function recordFeedbackReport(db: Database, userId: string, text: string): Promise<void> {
  try {
    await db.insert(reports).values({
      kind: 'feedback',
      fingerprint: `feedback:${randomUUID()}`,
      title: feedbackTitle(text),
      detail: text,
      userId,
    });
  } catch (err) {
    logger.warn(`feedback report not saved: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** The triage list: new and to-be-fixed items, quiet transient faults left out. */
export async function loadTriage(
  db: Database,
  now: Date = new Date(),
): Promise<{ items: TriageItem[]; extras: TriageExtras }> {
  const listed = and(
    inArray(reports.status, ['new', 'fix']),
    or(eq(reports.transient, false), gte(reports.count, TRANSIENT_FLOOR), eq(reports.status, 'fix')),
  );
  const rows = await db
    .select({
      id: reports.id,
      kind: reports.kind,
      title: reports.title,
      detail: reports.detail,
      count: reports.count,
      transient: reports.transient,
      status: reports.status,
      unseen: sql<boolean>`${reports.digestedAt} is null`,
    })
    .from(reports)
    .where(listed)
    .orderBy(asc(reports.id));

  const dayAgo = new Date(now.getTime() - 24 * 3600_000);
  const [quiet] = await db
    .select({ n: count() })
    .from(reports)
    .where(
      and(
        eq(reports.status, 'new'),
        eq(reports.transient, true),
        lt(reports.count, TRANSIENT_FLOOR),
        gte(reports.lastSeenAt, dayAgo),
      ),
    );
  const [issued] = await db.select({ n: count() }).from(reports).where(eq(reports.status, 'issued'));

  return {
    items: rows as TriageItem[],
    extras: { quietTransient: Number(quiet?.n ?? 0), inProgress: Number(issued?.n ?? 0) },
  };
}

export async function markDigested(db: Database, ids: number[], now: Date = new Date()): Promise<void> {
  if (ids.length === 0) return;
  await db.update(reports).set({ digestedAt: now }).where(inArray(reports.id, ids));
}

/**
 * The owner's press: fix, skip or back to new. Refused (false) once the item
 * is an issue or closed, since GitHub owns it from then on.
 */
export async function setReportStatus(db: Database, id: number, status: 'new' | 'fix' | 'skip'): Promise<boolean> {
  const changed = await db
    .update(reports)
    .set({ status })
    .where(and(eq(reports.id, id), inArray(reports.status, OPEN_STATUSES)))
    .returning({ id: reports.id });
  return changed.length > 0;
}

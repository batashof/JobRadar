import { Logger } from '@nestjs/common';

import type { Database } from '../db/db.module';
import { events } from '../db/schema';

/**
 * Funnel event names (ADR-024). A closed list, so a typo cannot open a new
 * series silently; later steps add theirs here (card_opened, feedback).
 */
export type EventName =
  | 'start'
  | 'account_deleted'
  | 'resume_uploaded'
  | 'resume_analyzed'
  | 'profile_confirmed';

const logger = new Logger('Events');

/**
 * Records one analytics event. Best-effort: losing a counter must never fail
 * the user-facing action that produced it.
 */
export async function recordEvent(
  db: Database,
  userId: string | null,
  name: EventName,
  props?: Record<string, string | number | boolean>,
): Promise<void> {
  try {
    await db.insert(events).values({ userId, name, props: props ?? null });
  } catch (err) {
    logger.warn(`event ${name} not recorded: ${err instanceof Error ? err.message : String(err)}`);
  }
}

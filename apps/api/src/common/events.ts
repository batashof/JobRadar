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
  | 'profile_confirmed'
  /** `/noresume` began a profile set by hand (ADR-034); `profile_confirmed` follows with `source: manual`. */
  | 'profile_manual_started'
  | 'bot_blocked'
  | 'settings_changed'
  /** A bot update or button failed (v2.6.0); props: `where`, `message`. */
  | 'error'
  /** A user sent `/feedback` (v2.6.0); the text goes to the owner, never into the event. */
  | 'feedback';

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

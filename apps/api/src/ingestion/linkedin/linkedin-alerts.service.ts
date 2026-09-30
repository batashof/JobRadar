import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DB, type Database } from '../../db/db.module';
import type { sources } from '../../db/schema';
import type { IngestResult } from '../hh/hh.service';
import type { NewVacancy } from '../hh/hh-normalize';
import { upsertVacancies } from '../vacancy-upsert';
import { fetchAlertMessages, type AlertMessage } from './alert-mailbox';
import { extractAlertQuery, parseLinkedInAlert } from './linkedin-alert-parse';
import { normalizeLinkedInJob } from './linkedin-normalize';

export interface LinkedInAlertsSourceConfig {
  /** Addresses LinkedIn sends job alerts from. */
  senders?: string[];
  /** IMAP folder; unset → the server's "All Mail", else INBOX. */
  mailbox?: string;
  /** How far back each run looks. Re-reading is idempotent (upsert by job id). */
  lookbackDays?: number;
  maxMessages?: number;
}

export const DEFAULT_ALERT_SENDERS = ['jobalerts-noreply@linkedin.com'];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * LinkedIn vacancies from the job-alert emails LinkedIn sends the user
 * (ADR-020, amending ADR-003). No request ever goes to linkedin.com: LinkedIn
 * runs the saved search and mails the result, and this worker reads the
 * user's own mailbox.
 */
@Injectable()
export class LinkedInAlertsIngestService {
  private readonly logger = new Logger(LinkedInAlertsIngestService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly config: ConfigService,
  ) {}

  async ingest(source: typeof sources.$inferSelect): Promise<IngestResult> {
    const config = (source.config ?? {}) as LinkedInAlertsSourceConfig;
    const user = this.config.get<string>('ALERTS_IMAP_USER');
    const password = this.config.get<string>('ALERTS_IMAP_PASSWORD');

    // Missing credentials are a deployment state, not source breakage — skip
    // quietly (notModified) instead of raising an 'empty' alert.
    if (!user || !password) {
      this.logger.warn('linkedin: ALERTS_IMAP_USER/ALERTS_IMAP_PASSWORD not set — skipping');
      return { fetched: 0, upserted: 0, notModified: true };
    }

    const messages = await this.readMailbox({
      host: this.config.get<string>('ALERTS_IMAP_HOST') || 'imap.gmail.com',
      port: Number(this.config.get<string>('ALERTS_IMAP_PORT') || 993),
      user,
      password,
      mailbox: config.mailbox,
      senders: config.senders?.length ? config.senders : DEFAULT_ALERT_SENDERS,
      since: new Date(Date.now() - (config.lookbackDays ?? 3) * DAY_MS),
      maxMessages: config.maxMessages ?? 50,
    });

    // Alerts are daily at best: a window without one is the normal case.
    if (messages.length === 0) {
      this.logger.log('linkedin: no alert emails in the lookback window');
      return { fetched: 0, upserted: 0, notModified: true };
    }

    const rows = collectVacancies(messages, source.id);
    // Emails arrived but no card came out of them: LinkedIn changed the layout.
    // Returning fetched: 0 marks the run 'empty', which is the alert we want.
    if (rows.length === 0) {
      this.logger.error(
        `linkedin: ${messages.length} alert emails yielded no jobs — the email layout likely changed`,
      );
      return { fetched: 0, upserted: 0 };
    }

    const upserted = await upsertVacancies(this.db, rows);
    this.logger.log(
      `linkedin ingest: ${messages.length} emails, ${rows.length} jobs, upserted ${upserted}`,
    );
    return { fetched: rows.length, upserted };
  }

  /** Seam for tests; the IMAP session itself lives in alert-mailbox.ts. */
  protected readMailbox(options: Parameters<typeof fetchAlertMessages>[0]): Promise<AlertMessage[]> {
    return fetchAlertMessages(options);
  }
}

/**
 * One row per job id across every email in the window. The same posting shows
 * up in several alerts (and in the same alert on consecutive days); the
 * earliest email dates it.
 */
export function collectVacancies(messages: AlertMessage[], sourceId: string): NewVacancy[] {
  const byId = new Map<string, NewVacancy>();
  const oldestFirst = [...messages].sort(
    (a, b) => (a.date?.getTime() ?? Infinity) - (b.date?.getTime() ?? Infinity),
  );
  for (const message of oldestFirst) {
    const alertQuery = extractAlertQuery(message);
    for (const job of parseLinkedInAlert(message)) {
      if (byId.has(job.jobId)) continue;
      byId.set(
        job.jobId,
        normalizeLinkedInJob(job, { sourceId, receivedAt: message.date, alertQuery }),
      );
    }
  }
  return [...byId.values()];
}

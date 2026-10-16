import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Language } from '@jobradar/shared';
import { and, eq, inArray } from 'drizzle-orm';

import { BotService } from '../../bot/bot.service';
import { DB, type Database } from '../../db/db.module';
import { type sources, users, vacancies, vacancyRecipients } from '../../db/schema';
import type { IngestResult } from '../hh/hh.service';
import type { NewVacancy } from '../hh/hh-normalize';
import { upsertVacancies } from '../vacancy-upsert';
import { fetchAlertMessages, type AlertMessage } from './alert-mailbox';
import { extractAlertQuery, parseLinkedInAlert } from './linkedin-alert-parse';
import {
  confirmationText,
  extractAlertsToken,
  GMAIL_FORWARDING_SENDER,
  isForwardingConfirmation,
  parseForwardingConfirmation,
} from './linkedin-forwarding';
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

/** Postgres bind-parameter headroom for the `in (...)` lists and inserts. */
const CHUNK = 500;

/** A bot user whose personal forwarding address appeared in this run (ADR-027). */
interface TokenUser {
  id: string;
  language: string;
  alertsConfirmationCode: string | null;
}

/**
 * LinkedIn vacancies from the job-alert emails LinkedIn sends the user
 * (ADR-021, amending ADR-003). No request ever goes to linkedin.com: LinkedIn
 * runs the saved search and mails the result, and this worker reads the
 * user's own mailbox.
 *
 * Every bot user can forward their own alerts to a personal plus address of
 * the same mailbox (ADR-027): the token in the recipient names the user, and
 * the vacancies from that email are recorded in `vacancy_recipients`, so they
 * reach that user — and only them — although the source is owner-only. Mail
 * to the bare address is the owner's, as before.
 */
@Injectable()
export class LinkedInAlertsIngestService {
  private readonly logger = new Logger(LinkedInAlertsIngestService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly bot: BotService,
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

    const alertSenders = config.senders?.length ? config.senders : DEFAULT_ALERT_SENDERS;
    const messages = await this.readMailbox({
      host: this.config.get<string>('ALERTS_IMAP_HOST') || 'imap.gmail.com',
      port: Number(this.config.get<string>('ALERTS_IMAP_PORT') || 993),
      user,
      password,
      mailbox: config.mailbox,
      // Gmail's forwarding confirmations are read too, to relay their codes.
      senders: [...alertSenders, GMAIL_FORWARDING_SENDER],
      since: new Date(Date.now() - (config.lookbackDays ?? 3) * DAY_MS),
      maxMessages: config.maxMessages ?? 50,
    });

    const confirmations = messages.filter(isForwardingConfirmation);
    const alerts = messages.filter((message) => !isForwardingConfirmation(message));
    const tokenOf = (message: AlertMessage) => extractAlertsToken(message.recipients, user);
    const usersByToken = await this.usersByToken(messages.map(tokenOf));

    if (confirmations.length > 0) {
      await this.relayConfirmations(confirmations, tokenOf, usersByToken);
    }

    // Alerts are daily at best: a window without one is the normal case.
    if (alerts.length === 0) {
      this.logger.log('linkedin: no alert emails in the lookback window');
      return { fetched: 0, upserted: 0, notModified: true };
    }

    // No token, or one nobody holds: the owner's own alert, as before ADR-027.
    const { rows, recipients } = collectAlerts(alerts, source.id, (message) => {
      const token = tokenOf(message);
      return (token && usersByToken.get(token)?.id) || null;
    });
    // Emails arrived but no card came out of them: LinkedIn changed the layout.
    // Returning fetched: 0 marks the run 'empty', which is the alert we want.
    if (rows.length === 0) {
      this.logger.error(
        `linkedin: ${alerts.length} alert emails yielded no jobs — the email layout likely changed`,
      );
      return { fetched: 0, upserted: 0 };
    }

    const upserted = await upsertVacancies(this.db, rows);
    const addressed = await this.recordRecipients(source.id, recipients);
    this.logger.log(
      `linkedin ingest: ${alerts.length} emails, ${rows.length} jobs, upserted ${upserted}, ` +
        `${addressed} user-addressed`,
    );
    return { fetched: rows.length, upserted };
  }

  /** One query for every token seen in the run. */
  private async usersByToken(tokens: (string | null)[]): Promise<Map<string, TokenUser>> {
    const unique = [...new Set(tokens.filter((token): token is string => !!token))];
    const byToken = new Map<string, TokenUser>();
    if (unique.length === 0) return byToken;
    const rows = await this.db
      .select({
        id: users.id,
        token: users.alertsToken,
        language: users.language,
        alertsConfirmationCode: users.alertsConfirmationCode,
      })
      .from(users)
      .where(inArray(users.alertsToken, unique));
    for (const row of rows) {
      if (row.token) byToken.set(row.token, row);
    }
    return byToken;
  }

  /**
   * Sends each user the newest Gmail forwarding-confirmation code addressed to
   * them, once: `users.alerts_confirmation_code` remembers the last code that
   * reached the chat, so the same email re-read every run is not resent.
   */
  private async relayConfirmations(
    confirmations: AlertMessage[],
    tokenOf: (message: AlertMessage) => string | null,
    usersByToken: Map<string, TokenUser>,
  ): Promise<void> {
    const newestFirst = [...confirmations].sort(
      (a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0),
    );
    const handled = new Set<string>();
    for (const message of newestFirst) {
      const token = tokenOf(message);
      const target = token ? usersByToken.get(token) : undefined;
      if (!target) {
        this.logger.warn('linkedin: forwarding confirmation for no known address — ignored');
        continue;
      }
      if (handled.has(target.id)) continue;
      const confirmation = parseForwardingConfirmation(message);
      if (!confirmation) {
        this.logger.warn('linkedin: forwarding confirmation without a code — ignored');
        continue;
      }
      handled.add(target.id);
      if (confirmation.code === target.alertsConfirmationCode) continue;

      const language: Language = target.language === 'en' ? 'en' : 'ru';
      const sent = await this.bot.sendToUser(target.id, confirmationText(language, confirmation), {
        parseMode: 'HTML',
      });
      // Remembered only once it reached the chat, so a failed send is retried next run.
      if (sent) {
        await this.db
          .update(users)
          .set({ alertsConfirmationCode: confirmation.code, updatedAt: new Date() })
          .where(eq(users.id, target.id));
      }
    }
  }

  /** Links the upserted vacancies to the users whose forwarded alerts carried them. */
  private async recordRecipients(
    sourceId: string,
    recipients: Map<string, Set<string>>,
  ): Promise<number> {
    const jobIds = [...recipients.keys()];
    if (jobIds.length === 0) return 0;

    const links: { vacancyId: string; userId: string }[] = [];
    for (let i = 0; i < jobIds.length; i += CHUNK) {
      const found = await this.db
        .select({ id: vacancies.id, externalId: vacancies.externalId })
        .from(vacancies)
        .where(
          and(
            eq(vacancies.sourceId, sourceId),
            inArray(vacancies.externalId, jobIds.slice(i, i + CHUNK)),
          ),
        );
      for (const row of found) {
        for (const userId of recipients.get(row.externalId) ?? []) {
          links.push({ vacancyId: row.id, userId });
        }
      }
    }
    for (let i = 0; i < links.length; i += CHUNK) {
      await this.db
        .insert(vacancyRecipients)
        .values(links.slice(i, i + CHUNK))
        .onConflictDoNothing();
    }
    return links.length;
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
  return collectAlerts(messages, sourceId, () => null).rows;
}

/**
 * The vacancy rows, plus which users each job id was addressed to: every
 * email that carried the job counts, not only the earliest one that dates it,
 * so a posting in both the owner's and a user's alert reaches that user.
 */
export function collectAlerts(
  messages: AlertMessage[],
  sourceId: string,
  recipientOf: (message: AlertMessage) => string | null,
): { rows: NewVacancy[]; recipients: Map<string, Set<string>> } {
  const byId = new Map<string, NewVacancy>();
  const recipients = new Map<string, Set<string>>();
  const oldestFirst = [...messages].sort(
    (a, b) => (a.date?.getTime() ?? Infinity) - (b.date?.getTime() ?? Infinity),
  );
  for (const message of oldestFirst) {
    const alertQuery = extractAlertQuery(message);
    const userId = recipientOf(message);
    for (const job of parseLinkedInAlert(message)) {
      if (userId) {
        const set = recipients.get(job.jobId) ?? new Set<string>();
        set.add(userId);
        recipients.set(job.jobId, set);
      }
      if (byId.has(job.jobId)) continue;
      byId.set(
        job.jobId,
        normalizeLinkedInJob(job, { sourceId, receivedAt: message.date, alertQuery }),
      );
    }
  }
  return { rows: [...byId.values()], recipients };
}

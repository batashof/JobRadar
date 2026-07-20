import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';

import { DB, type Database } from '../../db/db.module';
import type { sources } from '../../db/schema';
import type { IngestResult } from '../hh/hh.service';
import { upsertVacancies } from '../vacancy-upsert';
import { normalizeTelegramMessage } from './telegram-normalize';
import type { NewVacancy } from '../hh/hh-normalize';

interface TelegramSourceConfig {
  /** Public channel usernames (without @). Each post becomes a vacancy candidate. */
  channels?: string[];
  /** How many latest messages to scan per channel per run. */
  messagesPerChannel?: number;
}

@Injectable()
export class TelegramIngestService {
  private readonly logger = new Logger(TelegramIngestService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly config: ConfigService,
  ) {}

  async ingest(source: typeof sources.$inferSelect): Promise<IngestResult> {
    const config = (source.config ?? {}) as TelegramSourceConfig;
    const channels = config.channels ?? [];
    const limit = config.messagesPerChannel ?? 50;

    const apiId = Number(this.config.get<string>('TELEGRAM_API_ID'));
    const apiHash = this.config.get<string>('TELEGRAM_API_HASH');
    const session = this.config.get<string>('TELEGRAM_SESSION');

    // Missing secrets or channel list is a deployment state, not source
    // breakage — skip quietly (notModified) instead of raising an 'empty' alert.
    if (!apiId || !apiHash || !session) {
      this.logger.warn(
        'telegram: TELEGRAM_API_ID/TELEGRAM_API_HASH/TELEGRAM_SESSION not set — skipping',
      );
      return { fetched: 0, upserted: 0, notModified: true };
    }
    if (channels.length === 0) {
      this.logger.warn('telegram: no channels configured in sources.config — skipping');
      return { fetched: 0, upserted: 0, notModified: true };
    }

    const client = new TelegramClient(new StringSession(session), apiId, apiHash, {
      connectionRetries: 3,
      // Sleep through short FLOOD_WAITs instead of failing the run (politeness).
      floodSleepThreshold: 60,
    });

    const rows: NewVacancy[] = [];
    let fetched = 0;
    try {
      await client.connect();
      if (!(await client.isUserAuthorized())) {
        throw new Error('telegram session is not authorized — regenerate TELEGRAM_SESSION');
      }

      for (const channel of channels) {
        const messages = await client.getMessages(channel, { limit });
        fetched += messages.length;
        for (const message of messages) {
          if (!message.message) continue; // media-only / service messages
          const row = normalizeTelegramMessage(
            {
              channel,
              messageId: message.id,
              text: message.message,
              date: message.date ? new Date(message.date * 1000) : null,
            },
            source.id,
          );
          if (row) rows.push(row);
        }
        this.logger.log(`telegram @${channel}: scanned ${messages.length} messages`);
      }
    } finally {
      await client.disconnect().catch(() => undefined);
    }

    const upserted = rows.length > 0 ? await upsertVacancies(this.db, rows) : 0;
    this.logger.log(
      `telegram ingest: scanned ${fetched} messages, ${rows.length} vacancies, upserted ${upserted}`,
    );
    return { fetched: rows.length, upserted };
  }
}

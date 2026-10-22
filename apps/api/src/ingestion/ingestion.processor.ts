import { Inject, Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { eq } from 'drizzle-orm';

import { DB, type Database } from '../db/db.module';
import { sources } from '../db/schema';
import { DedupService, type DedupResult } from '../dedup/dedup.service';
import { MatchingService, type MatchRunResult } from '../matching/matching.service';
import { HhIngestService, type IngestResult } from './hh/hh.service';
import { HimalayasIngestService } from './himalayas/himalayas.service';
import { HnIngestService } from './hn/hn.service';
import { AtsIngestService } from './ats/ats.service';
import { JobicyIngestService } from './jobicy/jobicy.service';
import { LinkedInAlertsIngestService } from './linkedin/linkedin-alerts.service';
import { RemoteOkIngestService } from './remoteok/remoteok.service';
import { RemotiveIngestService } from './remotive/remotive.service';
import { TelegramIngestService } from './telegram/telegram.service';
import { UaBoardsIngestService } from './ua-boards/ua-boards.service';
import { WorkingNomadsIngestService } from './workingnomads/workingnomads.service';
import { WwrIngestService } from './wwr/wwr.service';
import type { IngestJobData } from './ingestion.types';
import { isSourceDue } from './schedule';

type JobOutcome =
  | IngestResult
  | DedupResult
  | MatchRunResult
  | { skipped: string };

/** Runs one ingestion job; `IngestionQueue` feeds it one at a time (ADR-031). */
@Injectable()
export class IngestionProcessor {
  private readonly logger = new Logger(IngestionProcessor.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly hh: HhIngestService,
    private readonly remoteok: RemoteOkIngestService,
    private readonly remotive: RemotiveIngestService,
    private readonly jobicy: JobicyIngestService,
    private readonly himalayas: HimalayasIngestService,
    private readonly hn: HnIngestService,
    private readonly ats: AtsIngestService,
    private readonly workingnomads: WorkingNomadsIngestService,
    private readonly telegram: TelegramIngestService,
    private readonly wwr: WwrIngestService,
    private readonly linkedin: LinkedInAlertsIngestService,
    private readonly uaBoards: UaBoardsIngestService,
    private readonly dedup: DedupService,
    private readonly matching: MatchingService,
  ) {}

  async process(data: IngestJobData): Promise<JobOutcome> {
    if (data.kind === 'dedup') {
      return this.dedup.run();
    }
    if (data.kind === 'match') {
      // Rules only. The background LLM résumé pass (ADR-011) is gone since
      // ADR-029: vacancies are scored by the formula, and the LLM is spent on
      // resumes alone. The web cabinet can still score on demand.
      return this.matching.rematchAll();
    }

    const source = await this.db.query.sources.findFirst({
      where: eq(sources.slug, data.slug),
    });
    if (!source || !source.isActive) return { skipped: 'inactive-or-unknown-source' };

    // The hook enqueues only due sources; this re-check covers a job that
    // waited in the queue behind a duplicate trigger.
    if (!isSourceDue(source, new Date(), data.force)) {
      this.logger.log(`${source.slug}: ran recently, skipping (politeness interval)`);
      return { skipped: 'ran-recently' };
    }

    try {
      let result: IngestResult;
      switch (source.slug) {
        case 'hh':
          result = await this.hh.ingest(source);
          break;
        case 'remoteok':
          result = await this.remoteok.ingest(source);
          break;
        case 'remotive':
          result = await this.remotive.ingest(source);
          break;
        case 'jobicy':
          result = await this.jobicy.ingest(source);
          break;
        case 'himalayas':
          result = await this.himalayas.ingest(source);
          break;
        case 'hn':
          result = await this.hn.ingest(source);
          break;
        case 'ats':
          result = await this.ats.ingest(source);
          break;
        case 'workingnomads':
          result = await this.workingnomads.ingest(source);
          break;
        case 'telegram':
          result = await this.telegram.ingest(source);
          break;
        case 'weworkremotely':
          result = await this.wwr.ingest(source);
          break;
        case 'linkedin':
          result = await this.linkedin.ingest(source);
          break;
        case 'dou':
          result = await this.uaBoards.ingestDou(source);
          break;
        case 'djinni':
          result = await this.uaBoards.ingestDjinni(source);
          break;
        default:
          this.logger.warn(`${source.slug}: no worker implemented yet`);
          return { skipped: 'no-worker' };
      }

      // 'empty' is an alerting signal: a healthy source should never yield zero
      // items — except when a conditional GET reports no changes.
      const status = result.fetched === 0 && !result.notModified ? 'empty' : 'ok';
      await this.db
        .update(sources)
        .set({ lastRunAt: new Date(), lastRunStatus: status })
        .where(eq(sources.id, source.id));
      return result;
    } catch (error) {
      // Jobs run outside any HTTP request, so the global Sentry filter
      // never sees them — capture here so a silently failing cron source is
      // visible. No-op when Sentry is disabled.
      Sentry.captureException(error, { tags: { source: source.slug, job: 'ingestion' } });
      await this.db
        .update(sources)
        .set({ lastRunAt: new Date(), lastRunStatus: 'error' })
        .where(eq(sources.id, source.id));
      throw error;
    }
  }
}

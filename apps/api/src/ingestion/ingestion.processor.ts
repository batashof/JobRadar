import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { Job } from 'bullmq';
import type { ResumeMatchRunResult } from '@jobradar/shared';
import { eq } from 'drizzle-orm';

import { DB, type Database } from '../db/db.module';
import { sources } from '../db/schema';
import { DedupService, type DedupResult } from '../dedup/dedup.service';
import { MatchingService, type MatchRunResult } from '../matching/matching.service';
import { ResumeMatchingService } from '../matching/resume-matching.service';
import { HhIngestService, type IngestResult } from './hh/hh.service';
import { HimalayasIngestService } from './himalayas/himalayas.service';
import { HnIngestService } from './hn/hn.service';
import { AtsIngestService } from './ats/ats.service';
import { JobicyIngestService } from './jobicy/jobicy.service';
import { RemoteOkIngestService } from './remoteok/remoteok.service';
import { RemotiveIngestService } from './remotive/remotive.service';
import { TelegramIngestService } from './telegram/telegram.service';
import { WorkingNomadsIngestService } from './workingnomads/workingnomads.service';
import { WwrIngestService } from './wwr/wwr.service';
import { INGESTION_QUEUE, type IngestJobData } from './ingestion.types';

/** Politeness: never fetch a source more often than this (docs/DATA_SOURCES.md). */
const MIN_INTERVAL_MS = 4 * 60 * 60 * 1000;

/**
 * Idle-polling budget on Upstash (ADR-001, ADR-007). A BullMQ worker blocks on
 * Redis waiting for a job and re-issues that command every `drainDelay`, and
 * runs a stalled-job sweep every `stalledInterval` — both count against the
 * Upstash free-tier command quota (500k/mo). Jobs here arrive at most every 4h
 * (ADR-006 cron), so the defaults (5s / 30s ≈ 20k commands/day) are pure waste.
 * A newly enqueued job still wakes the blocking pop immediately, so relaxing
 * these adds no latency to real work — only ~12× fewer idle commands.
 */
const IDLE_POLL_OPTIONS = { drainDelay: 60, stalledInterval: 300_000 };

type JobOutcome =
  | IngestResult
  | DedupResult
  | MatchRunResult
  | (MatchRunResult & { resumeMatching: ResumeMatchRunResult })
  | { skipped: string };

@Processor(INGESTION_QUEUE, IDLE_POLL_OPTIONS)
export class IngestionProcessor extends WorkerHost {
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
    private readonly dedup: DedupService,
    private readonly matching: MatchingService,
    private readonly resumeMatching: ResumeMatchingService,
  ) {
    super();
  }

  async process(job: Job<IngestJobData>): Promise<JobOutcome> {
    if (job.data.kind === 'dedup') {
      return this.dedup.run();
    }
    if (job.data.kind === 'match') {
      const result = await this.matching.rematchAll();
      // LLM pass rides the same job: budget-capped, cached, and a no-op
      // without an LLM key — never fails the rules-based matching (ADR-011).
      try {
        const resumeRun = await this.resumeMatching.scorePending();
        return { ...result, resumeMatching: resumeRun };
      } catch (err) {
        this.logger.warn(`resume matching failed (non-fatal): ${String(err)}`);
        return result;
      }
    }

    const source = await this.db.query.sources.findFirst({
      where: eq(sources.slug, job.data.slug),
    });
    if (!source || !source.isActive) return { skipped: 'inactive-or-unknown-source' };

    const ranRecently =
      source.lastRunAt !== null && Date.now() - source.lastRunAt.getTime() < MIN_INTERVAL_MS;
    if (ranRecently && source.lastRunStatus === 'ok' && !job.data.force) {
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
      // Queue jobs run outside any HTTP request, so the global Sentry filter
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

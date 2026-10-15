import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BOT_CALLBACK_NAMESPACES,
  detectSeniority,
  DIGEST_MAX_ITEMS_LIMIT,
  type Language,
  levelsBelowResume,
  PLANNER_DEFAULTS,
} from '@jobradar/shared';
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  notExists,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

import { type BotCallbackContext, type BotCallbackResult, BotService } from '../bot/bot.service';
import { DB, type Database } from '../db/db.module';
import {
  digestItems,
  digestSettings,
  hiddenVacancies,
  plannerSettings,
  profileMatches,
  resumeMatches,
  resumes,
  searchProfiles,
  sources,
  telegramAccounts,
  users,
  vacancies,
} from '../db/schema';
import { LlmService } from '../llm/llm.service';
import { extractResumeTerms, lexicalRelevanceSql, normalizeLexScore } from '../matching/resume-terms';
import { isQuietTime, resolveDue } from './due';
import { DIGEST_ACTION, digestText, renderCardParts, renderHeader, renderKeyboard } from './render';
import {
  buildBatchPrompt,
  type DigestCandidate,
  dropTooJunior,
  fallbackScores,
  parseBatchReply,
  rankScore,
  type ScoredCandidate,
  shortlist,
} from './select';

/**
 * How many candidates the LLM ranks in one call. Above this the prompt bloats,
 * so a larger window is scored as several calls of this size (ADR-022).
 */
const BATCH_LIMIT = 30;

/**
 * Output budget for that one call. A verdict costs ~75 tokens once its Russian
 * note is written, so a full batch needs ~2300 — 1600 cut the reply off partway
 * through and, before the parser learned to salvage what arrived, cost the whole
 * digest. The headroom above 2300 is for models that reason before answering.
 */
const SCORING_MAX_TOKENS = 3000;

/**
 * How many vacancies one send judges at most, best-ranked first. Comfortably
 * more than a day of intake; it exists so a window left open by a long outage
 * costs a bounded number of LLM calls (CANDIDATE_POOL / BATCH_LIMIT) rather
 * than one per thirty postings on the board. Kept equal to the shared
 * DIGEST_MAX_ITEMS_LIMIT, so a typed-in cap can never exceed what is judged.
 */
const CANDIDATE_POOL = DIGEST_MAX_ITEMS_LIMIT;

/** How far back to look for unsent vacancies — older ones are not news. */
const CANDIDATE_WINDOW_DAYS = 14;

/**
 * Instant mode (ADR-020) only considers vacancies ingested at least this long
 * ago: dedup and matching run after the source jobs, and a posting seen in
 * three channels must be pushed once, as its canonical row. Five minutes since
 * ADR-023: a 10-minute tick fetches only Telegram and LinkedIn alerts, and its
 * dedup + match jobs finish within a couple of minutes.
 */
export const INSTANT_SETTLE_MINUTES = 5;

/** Where a fresh watermark starts: the last day, not the board. */
const FIRST_LOOKBACK_HOURS = 24;

/**
 * A delivery window over `vacancies.ingested_at` — what arrived since the last
 * send (ADR-020, ADR-022). Both ends are Postgres text so the microseconds
 * survive the round trip into `judged_through`.
 */
interface IngestWindow {
  after: string;
  until: string;
}

/**
 * Placeholder resume id for the cached-score join when the user has no active
 * resume — matches nothing, so every resumeScore comes back null. Same trick
 * the feed uses (VacanciesService).
 */
const NO_RESUME = '00000000-0000-0000-0000-000000000000';

export interface DigestRunResult {
  users: number;
  sent: number;
  vacancies: number;
  skipped: number;
  /** Instant-mode users whose window held new vacancies this tick (ADR-020). */
  instant: number;
}

/**
 * The digest itself: pick, score, send. Reads `digest_settings` for the
 * schedule (ADR-015 §7 timezone), the bot channel for delivery, and writes
 * `digest_items` so a vacancy is never pushed twice.
 *
 * Cost discipline (ADR-005): SQL narrows to vacancies that already pass
 * rules-based profile matching and were never sent, then one LLM call per 30
 * of them ranks the window — all of it, since v1.24 (ADR-022). With no LLM key the run still happens, ordered by the
 * rules score — the same llm/fallback shape the planner uses.
 */
@Injectable()
export class DigestSendService implements OnModuleInit {
  private readonly logger = new Logger(DigestSendService.name);
  private readonly webOrigin: string;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly bot: BotService,
    private readonly llm: LlmService,
    config: ConfigService,
  ) {
    this.webOrigin = (config.get<string>('WEB_ORIGIN') ?? '').replace(/\/$/, '');
  }

  onModuleInit(): void {
    this.bot.registerCallback(BOT_CALLBACK_NAMESPACES.digest, (ctx) => this.handleCallback(ctx));
  }

  /** Every user whose schedule has come round. One bad user never stops the rest. */
  async run(now = new Date()): Promise<DigestRunResult> {
    const rows = await this.db
      .select({
        userId: digestSettings.userId,
        enabled: digestSettings.enabled,
        sendTimes: digestSettings.sendTimes,
        maxItems: digestSettings.maxItems,
        minScore: digestSettings.minScore,
        lastSentKey: digestSettings.lastSentKey,
        mode: digestSettings.mode,
        quietStart: digestSettings.quietStart,
        quietEnd: digestSettings.quietEnd,
        instantMinScore: digestSettings.instantMinScore,
        judgedThrough: digestSettings.judgedThrough,
        timezone: plannerSettings.timezone,
        language: users.language,
      })
      .from(digestSettings)
      .innerJoin(users, eq(users.id, digestSettings.userId))
      .leftJoin(plannerSettings, eq(plannerSettings.userId, digestSettings.userId))
      .innerJoin(telegramAccounts, eq(telegramAccounts.userId, digestSettings.userId))
      // The LLM-verdict digest is owner-only (ADR-024 §3); other users get the
      // formula-scored digest of ADR-025 once it lands (roadmap 5.3).
      .where(
        and(
          eq(digestSettings.enabled, true),
          eq(users.role, 'owner'),
          sql`${telegramAccounts.chatId} is not null`,
        ),
      );

    const result: DigestRunResult = {
      users: rows.length,
      sent: 0,
      vacancies: 0,
      skipped: 0,
      instant: 0,
    };

    for (const row of rows) {
      try {
        if (row.mode === 'instant') {
          const count = await this.runInstant(
            { ...row, timezone: row.timezone ?? PLANNER_DEFAULTS.timezone },
            now,
          );
          if (count !== null) {
            result.instant += 1;
            result.vacancies += count;
          }
          continue;
        }

        const due = resolveDue({
          sendTimes: row.sendTimes,
          timezone: row.timezone ?? PLANNER_DEFAULTS.timezone,
          now,
          lastSentKey: row.lastSentKey,
        });
        if (due.kind === 'idle') continue;
        if (due.kind === 'stale') {
          // The slot elapsed while the process was asleep. Consume it so it
          // cannot fire at a wrong hour, and let the next slot do the work.
          await this.markSent(row.userId, due.key);
          result.skipped += 1;
          continue;
        }

        // Only what arrived since the previous send (ADR-022): the slot is a
        // report of the news, not a re-ranking of the fortnight. No window
        // means nothing new, which the user still hears about at this hour.
        const window = await this.ingestWindow(row.judgedThrough);
        const count = window
          ? await this.sendFor(
              { ...row, timezone: row.timezone ?? PLANNER_DEFAULTS.timezone },
              due.key,
              now,
              { kind: 'digest', window },
            )
          : await this.sendEmpty(row.userId, row.language);
        await this.markSent(row.userId, due.key, window?.until);
        result.sent += 1;
        result.vacancies += count;
      } catch (err) {
        this.logger.error(
          `digest failed for user ${row.userId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    if (result.sent || result.skipped || result.instant) {
      this.logger.log(
        `digest: ${result.sent} send(s), ${result.instant} instant, ` +
          `${result.vacancies} vacancies, ${result.skipped} stale slot(s)`,
      );
    }
    return result;
  }

  /**
   * Instant delivery for one user (ADR-020): if vacancies arrived since the
   * watermark and it is not quiet time, run the funnel over exactly those and
   * move the watermark past them — all of them that clear the floor go out
   * (ADR-022). Returns how many were pushed, or null when
   * there was nothing to consider (quiet hours, or no new vacancies).
   *
   * Quiet hours leave the watermark where it is, so the night's arrivals go
   * out as one push when they end. The watermark moves even when nothing
   * clears the floor: those vacancies were judged, and judging them again
   * every five minutes would spend an LLM call per tick on the same answer.
   */
  private async runInstant(
    user: {
      userId: string;
      maxItems: number | null;
      instantMinScore: number;
      quietStart: string;
      quietEnd: string;
      judgedThrough: string | null;
      timezone: string;
      language: string;
    },
    now: Date,
  ): Promise<number | null> {
    if (isQuietTime({ now, ...user })) return null;

    const window = await this.ingestWindow(user.judgedThrough);
    if (!window) return null;

    const count = await this.sendFor(
      { ...user, minScore: user.instantMinScore },
      `instant ${window.until}`,
      now,
      { kind: 'instant', window },
    );
    await this.db
      .update(digestSettings)
      .set({ judgedThrough: sql`${window.until}::timestamptz`, updatedAt: new Date() })
      .where(eq(digestSettings.userId, user.userId));
    return count;
  }

  /**
   * The next window for a watermark, or null when nothing settled has been
   * ingested past it. One aggregate row — this runs every tick for every
   * instant user, so it must never pull vacancy text over the wire. The
   * settle delay applies to both modes: a scheduled send that judged a
   * posting before dedup ran would push a duplicate just the same.
   */
  private async ingestWindow(after: string | null): Promise<IngestWindow | null> {
    const from = after
      ? sql`${after}::timestamptz`
      : sql`now() - make_interval(hours => ${FIRST_LOOKBACK_HOURS})`;
    const [row] = await this.db
      .select({
        after: sql<string>`(${from})::text`,
        until: sql<string | null>`max(${vacancies.ingestedAt})::text`,
      })
      .from(vacancies)
      .where(
        and(
          isNull(vacancies.canonicalVacancyId),
          sql`${vacancies.ingestedAt} > ${from}`,
          sql`${vacancies.ingestedAt} <= now() - make_interval(mins => ${INSTANT_SETTLE_MINUTES})`,
        ),
      );
    return row?.until ? { after: row.after, until: row.until } : null;
  }

  /** Runs one user's digest immediately, ignoring the schedule (manual trigger). */
  async sendNow(userId: string, now = new Date()): Promise<number> {
    const [row] = await this.db
      .select({
        userId: digestSettings.userId,
        maxItems: digestSettings.maxItems,
        minScore: digestSettings.minScore,
        timezone: plannerSettings.timezone,
        language: users.language,
      })
      .from(digestSettings)
      .innerJoin(users, eq(users.id, digestSettings.userId))
      .leftJoin(plannerSettings, eq(plannerSettings.userId, digestSettings.userId))
      .where(eq(digestSettings.userId, userId));
    if (!row) return 0;

    // No window and no watermark move: a manual send is "show me what you
    // have", over every unsent vacancy of the fortnight, and must not make the
    // next scheduled slot skip the news it was going to report.
    return this.sendFor(
      { ...row, timezone: row.timezone ?? PLANNER_DEFAULTS.timezone },
      `manual ${now.toISOString()}`,
      now,
      { kind: 'manual' },
    );
  }

  // -------------------------------------------------------------------------
  // The funnel
  // -------------------------------------------------------------------------

  private async sendFor(
    user: {
      userId: string;
      maxItems: number | null;
      minScore: number;
      timezone: string;
      language: string;
    },
    slotKey: string,
    now: Date,
    /**
     * Which push this is, and the ingestion window it covers. A manual send has
     * no window and weighs the whole unsent fortnight; instant mode answers an
     * empty result with silence instead of "nothing today".
     */
    run: { kind: 'digest' | 'instant' | 'manual'; window?: IngestWindow },
  ): Promise<number> {
    const instant = run.kind === 'instant';
    const language: Language = user.language === 'en' ? 'en' : 'ru';
    const resume = await this.activeResume(user.userId);
    const candidates = await this.collectCandidates(user.userId, now, resume, run.window);
    if (candidates.length === 0) {
      if (!instant) await this.sendEmpty(user.userId, language);
      return 0;
    }

    const scored = await this.score(user.userId, candidates, resume?.text ?? null, language);
    const picked = shortlist(scored, user.maxItems, user.minScore);
    if (picked.length === 0) {
      // An empty digest is a legitimate outcome and a plausible symptom of a
      // broken funnel, and the two are indistinguishable from the outside —
      // both bugs fixed in v1.19.1 and v1.20.1 sent this exact message for days
      // without a trace. The best score of the batch tells them apart.
      const best = scored.reduce((max, item) => Math.max(max, item.score), 0);
      this.logger.log(
        `${instant ? 'instant push' : 'digest'} empty for user ${user.userId}: ` +
          `${candidates.length} candidate(s), best score ${best}, floor ${user.minScore}`,
      );
      // Several empty pushes a day would be pure noise; a scheduled digest
      // says so once, because the user is waiting for it at that hour.
      if (!instant) await this.sendEmpty(user.userId, language);
      return 0;
    }

    const header = renderHeader(language, picked.length, instant ? 'instant' : 'digest');
    await this.bot.sendToUser(user.userId, header, {
      parseMode: 'HTML',
      disablePreview: true,
    });

    for (const item of picked) {
      // A card carries the whole posting, which routinely outgrows Telegram's
      // 4096-character message. The buttons ride on the last part so they sit
      // under the text they act on — and that is the message `digest_items`
      // remembers, since it is the one a callback comes back to edit.
      const parts = renderCardParts(item, language, user.timezone);
      let messageId: string | null = null;
      for (const [index, part] of parts.entries()) {
        const isLast = index === parts.length - 1;
        messageId = await this.bot.sendToUser(user.userId, part, {
          parseMode: 'HTML',
          disablePreview: true,
          keyboard: isLast ? renderKeyboard(item, language, this.webOrigin) : undefined,
        });
      }
      // Recorded even when the send failed: a vacancy the user already saw
      // once must not come back, and a silent Telegram failure is not a reason
      // to re-push it tomorrow.
      await this.db
        .insert(digestItems)
        .values({
          userId: user.userId,
          vacancyId: item.id,
          score: item.score,
          slotKey,
          messageId,
        })
        .onConflictDoNothing();
    }

    return picked.length;
  }

  /**
   * The canonical vacancies the user has neither been sent nor hidden —
   * deliberately the same population the in-app feed draws from
   * (VacanciesService.feed). This used to start from `profile_matches`, which
   * made an active search profile a hard gate: an account without one got
   * "nothing worth your attention" every single day while the feed was full of
   * matches. Profiles are a ranking signal here now, not an entry condition.
   *
   * Ordering is the other half of that story. Taking the *freshest* rows and
   * re-ranking them in memory only works when the cached signals exist; for an
   * account with no search profile and no scored resume matches they are all
   * zero, so the LLM was handed the 30 newest postings on the board — product,
   * marketing and support roles for a frontend résumé — and correctly scored
   * every one of them below the floor. The pool is ordered by résumé relevance
   * first now, computed in SQL over the whole window, so the expensive stage
   * sees the plausible vacancies rather than the recent ones.
   *
   * This is the cheap stage and it does all the narrowing it can before any
   * token is spent.
   */
  private async collectCandidates(
    userId: string,
    now: Date,
    resume: { id: string; text: string } | null,
    window?: IngestWindow,
  ): Promise<DigestCandidate[]> {
    const since = new Date(now.getTime() - CANDIDATE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const conditions: SQL[] = [
      isNull(vacancies.canonicalVacancyId),
      gte(vacancies.ingestedAt, since),
      // Both modes narrow to what arrived since the last push; the 14-day
      // bound above still caps a window left open by a long sleep.
      ...(window
        ? [
            sql`${vacancies.ingestedAt} > ${window.after}::timestamptz`,
            sql`${vacancies.ingestedAt} <= ${window.until}::timestamptz`,
          ]
        : []),
      notExists(
        this.db
          .select({ one: sql`1` })
          .from(digestItems)
          .where(and(eq(digestItems.userId, userId), eq(digestItems.vacancyId, vacancies.id))),
      ),
      notExists(
        this.db
          .select({ one: sql`1` })
          .from(hiddenVacancies)
          .where(
            and(eq(hiddenVacancies.userId, userId), eq(hiddenVacancies.vacancyId, vacancies.id)),
          ),
      ),
    ];

    // Level gate before any token is spent (ADR-012): a push has no room for
    // roles the user has clearly outgrown. Rows ingestion never levelled pass
    // here and are caught by title below, so the pool never over-empties.
    const resumeLevel = resume ? detectSeniority(resume.text) : null;
    const tooJunior = resumeLevel ? levelsBelowResume(resumeLevel) : [];
    if (tooJunior.length > 0) {
      const clause = or(isNull(vacancies.seniority), notInArray(vacancies.seniority, tooJunior));
      if (clause) conditions.push(clause);
    }

    const relevance = lexicalRelevanceSql(
      extractResumeTerms(resume?.text ?? ''),
      vacancies.title,
      vacancies.description,
    );

    const rows = await this.db
      .select({
        id: vacancies.id,
        title: vacancies.title,
        company: vacancies.companyRaw,
        description: vacancies.description,
        location: vacancies.location,
        seniority: vacancies.seniority,
        salaryMin: vacancies.salaryMin,
        salaryMax: vacancies.salaryMax,
        salaryCurrency: vacancies.salaryCurrency,
        workFormat: vacancies.workFormat,
        employmentType: vacancies.employmentType,
        applyContact: vacancies.applyContact,
        sourceSlug: sources.slug,
        url: vacancies.url,
        publishedAt: vacancies.publishedAt,
        resumeScore: resumeMatches.score,
        lexScore: relevance,
      })
      .from(vacancies)
      .leftJoin(sources, eq(sources.id, vacancies.sourceId))
      .leftJoin(
        resumeMatches,
        and(
          eq(resumeMatches.vacancyId, vacancies.id),
          eq(resumeMatches.resumeId, resume?.id ?? NO_RESUME),
        ),
      )
      .where(and(...conditions))
      .orderBy(
        sql`${relevance} desc, ${vacancies.publishedAt} desc nulls last, ${vacancies.ingestedAt} desc`,
      )
      .limit(CANDIDATE_POOL);

    const ruleScores = await this.ruleScores(
      userId,
      rows.map((row) => row.id),
    );

    const candidates: DigestCandidate[] = rows.map((row) => ({
      ...row,
      resumeScore: row.resumeScore ?? 0,
      ruleScore: ruleScores.get(row.id) ?? 0,
      lexScore: normalizeLexScore(row.lexScore),
    }));

    // Title-based catch for the rows ingestion left unlevelled.
    return dropTooJunior(candidates, resumeLevel)
      .sort(
        (a, b) =>
          rankScore(b) - rankScore(a) ||
          (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
      );
  }

  /**
   * Best rules-based score per vacancy across the user's active search
   * profiles. Empty for a user with no profiles — which is now a ranking with
   * one signal fewer, not an empty digest.
   */
  private async ruleScores(userId: string, vacancyIds: string[]): Promise<Map<string, number>> {
    if (vacancyIds.length === 0) return new Map();

    const rows = await this.db
      .select({
        vacancyId: profileMatches.vacancyId,
        score: sql<number>`max(${profileMatches.score})`,
      })
      .from(profileMatches)
      .innerJoin(searchProfiles, eq(searchProfiles.id, profileMatches.profileId))
      .where(
        and(
          eq(searchProfiles.userId, userId),
          eq(searchProfiles.isActive, true),
          inArray(profileMatches.vacancyId, vacancyIds),
        ),
      )
      .groupBy(profileMatches.vacancyId);

    return new Map(rows.map((row) => [row.vacancyId, row.score]));
  }

  private async activeResume(userId: string): Promise<{ id: string; text: string } | null> {
    const [resume] = await this.db
      .select({ id: resumes.id, text: resumes.extractedText })
      .from(resumes)
      .where(and(eq(resumes.userId, userId), eq(resumes.isActive, true)))
      .orderBy(desc(resumes.uploadedAt))
      .limit(1);
    return resume ?? null;
  }

  /**
   * Scores every candidate, BATCH_LIMIT per LLM call (ADR-022). Until v1.24
   * only the best-ranked thirty were ever scored and everything past them was
   * silently dropped, which — with the cap of ten on top — was why every push
   * held exactly ten vacancies however many had arrived. The calls run one
   * after another: free tiers limit tokens per minute, and a parallel burst
   * would trip that on exactly the busy days that need several calls.
   */
  private async score(
    userId: string,
    candidates: DigestCandidate[],
    resumeText: string | null,
    language: Language,
  ): Promise<ScoredCandidate[]> {
    const scored: ScoredCandidate[] = [];
    for (let start = 0; start < candidates.length; start += BATCH_LIMIT) {
      const batch = candidates.slice(start, start + BATCH_LIMIT);
      scored.push(...(await this.scoreBatch(userId, batch, resumeText, language)));
    }
    return scored;
  }

  /** One LLM call for one batch; deterministic ordering when it cannot run. */
  private async scoreBatch(
    userId: string,
    candidates: DigestCandidate[],
    resumeText: string | null,
    language: Language,
  ): Promise<ScoredCandidate[]> {
    if (!resumeText || !this.llm.isConfigured()) {
      return fallbackScores(candidates);
    }

    try {
      const prompt = buildBatchPrompt(candidates, resumeText, language);
      const reply = await this.llm.complete({
        ...prompt,
        maxTokens: SCORING_MAX_TOKENS,
        temperature: 0.2,
      });
      const scored = parseBatchReply(reply.text, candidates);
      // A reply that parsed to nothing is a failed call, not an empty digest.
      return scored.length > 0 ? scored : fallbackScores(candidates);
    } catch (err) {
      this.logger.warn(
        `digest scoring fell back to rules for user ${userId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return fallbackScores(candidates);
    }
  }

  /** The scheduled digest's "nothing worth your attention" — the user is waiting for it. */
  private async sendEmpty(userId: string, language: string): Promise<number> {
    await this.bot.sendToUser(userId, digestText(language === 'en' ? 'en' : 'ru', 'empty'));
    return 0;
  }

  /**
   * Consumes a slot and, when the send covered a window, moves the watermark
   * past it — those vacancies were judged, and the next slot reports only
   * what arrives after them (ADR-022).
   */
  private async markSent(userId: string, key: string, judgedThrough?: string): Promise<void> {
    await this.db
      .update(digestSettings)
      .set({
        lastSentKey: key,
        ...(judgedThrough ? { judgedThrough: sql`${judgedThrough}::timestamptz` } : {}),
        updatedAt: new Date(),
      })
      .where(eq(digestSettings.userId, userId));
  }

  // -------------------------------------------------------------------------
  // Buttons
  // -------------------------------------------------------------------------

  private async handleCallback(ctx: BotCallbackContext): Promise<BotCallbackResult> {
    const [, action, vacancyId] = ctx.parts;
    if (!action || !vacancyId) return {};

    switch (action) {
      case DIGEST_ACTION.hide:
        await this.db
          .insert(hiddenVacancies)
          .values({ userId: ctx.userId, vacancyId })
          .onConflictDoNothing();
        return {
          alert: digestText(ctx.language, 'hidden'),
          editText: digestText(ctx.language, 'hidden'),
          editKeyboard: null,
        };
      case DIGEST_ACTION.up:
      case DIGEST_ACTION.down: {
        const feedback = action === DIGEST_ACTION.up ? 1 : -1;
        await this.db
          .update(digestItems)
          .set({ feedback })
          .where(
            and(eq(digestItems.userId, ctx.userId), eq(digestItems.vacancyId, vacancyId)),
          );
        return { alert: digestText(ctx.language, feedback > 0 ? 'liked' : 'disliked') };
      }
      default:
        return {};
    }
  }
}

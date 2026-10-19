import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  BOT_CALLBACK_NAMESPACES,
  type CandidateSkill,
  canonicalSkill,
  detectSeniority,
  DIGEST_MAX_ITEMS_LIMIT,
  type FeedbackWeights,
  isOwnerRole,
  type Language,
  levelsBelowResume,
  PLANNER_DEFAULTS,
  type SeniorityLevel,
  SENIORITY_LEVELS,
  skillTextPatterns,
  type UserRole,
} from '@jobradar/shared';
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  notExists,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

import { ApplicationsService } from '../applications/applications.service';
import { type BotCallbackContext, type BotCallbackResult, BotService } from '../bot/bot.service';
import { DB, type Database } from '../db/db.module';
import {
  candidateProfiles,
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
  vacancyRecipients,
} from '../db/schema';
import { fallbackProfile } from '../candidate/analysis';
import {
  extractResumeTerms,
  lexicalRelevanceSql,
  normalizeLexScore,
  RESUME_STACK_LIMIT,
  ROLE_FAMILIES,
  type ResumeTerms,
} from '../matching/resume-terms';
import {
  applyFeedback,
  type DeliveryPreferences,
  detectVacancySkills,
  EMPTY_FEEDBACK,
  explainScore,
  type FeedbackKind,
  passesPreferences,
  roleFamily,
  type ScoringProfile,
  scoreVacancy,
} from '../matching/score';
import { isQuietTime, resolveDue } from './due';
import { DIGEST_ACTION, digestText, renderCardParts, renderHeader, renderKeyboard } from './render';
import {
  type DigestCandidate,
  dropTooJunior,
  rankScore,
  type ScoredCandidate,
  shortlist,
} from './select';

/**
 * `sources.config.ownerOnly`: a source delivered to the owner only (roadmap
 * 5.4). One switch in the seed, no migration; unset means everyone.
 */
export const ownerOnlySource = sql`coalesce((${sources.config} ->> 'ownerOnly')::boolean, false)`;

/**
 * A vacancy addressed to this user in particular: one from the LinkedIn alerts
 * they forwarded to their own address (ADR-027). It reaches them although its
 * source is owner-only.
 */
export function addressedToUser(userId: string): SQL {
  return sql`exists (select 1 from ${vacancyRecipients} where ${vacancyRecipients.vacancyId} = ${vacancies.id} and ${vacancyRecipients.userId} = ${userId})`;
}

/**
 * How many vacancies one send judges at most, best-ranked first. Comfortably
 * more than a day of intake; it bounds the work a window left open by a long
 * outage costs. Kept equal to the shared
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

/** Who a send is for: the account, its language and role, and its hard preferences. */
interface DigestUser extends DeliveryPreferences {
  userId: string;
  maxItems: number | null;
  minScore: number;
  timezone: string;
  language: string;
  role: string;
  mutedSources: string[];
}

/**
 * What a send ranks against: a candidate profile judged by the formula, for
 * every user the owner included (ADR-029). The owner's profile need not be
 * confirmed and falls back to the resume's terms; the owner also sees
 * owner-only sources and their cached resume scores still help the pre-rank.
 */
interface MatchBasis {
  owner: boolean;
  terms: ResumeTerms;
  level: SeniorityLevel | null;
  profile: ScoringProfile;
  weights: FeedbackWeights;
  resumeId: string | null;
}

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
 * No LLM on this path (ADR-029): SQL narrows to unsent vacancies ranked by
 * resume relevance, and the formula scores every one of them against the
 * candidate profile — skill tags from the dictionary, grade, title, salary.
 */
@Injectable()
export class DigestSendService implements OnModuleInit {
  private readonly logger = new Logger(DigestSendService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly bot: BotService,
    private readonly applications: ApplicationsService,
  ) {}

  onModuleInit(): void {
    this.bot.registerCallback(BOT_CALLBACK_NAMESPACES.digest, (ctx) => this.handleCallback(ctx));
    this.bot.registerCommand('digest', async (ctx) => {
      this.startOnRequest(ctx.userId, ctx.role, ctx.language);
    });
  }

  /**
   * "Send me what you have" from the chat (/digest, or the button in
   * /settings): the same manual send as the web cabinet's. It runs after the
   * webhook has answered, since a long list is paced at one message a second.
   */
  private startOnRequest(userId: string, role: UserRole, language: Language): void {
    void this.sendOnRequest(userId, role, language).catch((err: unknown) =>
      this.bot.reportError('send now (/digest)', err, userId),
    );
  }

  /** Exposed for tests; the bot entry points go through `startOnRequest`. */
  async sendOnRequest(userId: string, role: UserRole, language: Language): Promise<number> {
    if (!(await this.matchBasis(userId, role))) {
      await this.bot.sendToUser(userId, digestText(language, 'noProfile'));
      return 0;
    }
    return this.sendNow(userId, new Date(), 'nothingNew');
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
        ...preferenceColumns,
        timezone: plannerSettings.timezone,
        language: users.language,
        role: users.role,
      })
      .from(digestSettings)
      .innerJoin(users, eq(users.id, digestSettings.userId))
      .leftJoin(plannerSettings, eq(plannerSettings.userId, digestSettings.userId))
      .leftJoin(candidateProfiles, eq(candidateProfiles.userId, digestSettings.userId))
      .innerJoin(telegramAccounts, eq(telegramAccounts.userId, digestSettings.userId))
      // Everyone is judged by the formula (ADR-029). A user's profile waits for
      // them to confirm it (ADR-025 §2, §8); the owner's falls back to the resume.
      .where(
        and(
          eq(digestSettings.enabled, true),
          sql`${telegramAccounts.chatId} is not null`,
          or(eq(users.role, 'owner'), isNotNull(candidateProfiles.confirmedAt)),
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
        await this.bot.reportError('scheduled digest', err, row.userId);
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
   * every five minutes would give the same answer.
   */
  private async runInstant(
    user: Omit<DigestUser, 'minScore'> & {
      instantMinScore: number;
      quietStart: string;
      quietEnd: string;
      judgedThrough: string | null;
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

  /**
   * Runs one user's digest immediately, ignoring the schedule (manual trigger).
   * `emptyKey` is what an empty result says: the web's send keeps the
   * scheduled digest's wording, the bot's button says nothing is new.
   */
  async sendNow(
    userId: string,
    now = new Date(),
    emptyKey: 'empty' | 'nothingNew' = 'empty',
  ): Promise<number> {
    const [row] = await this.db
      .select({
        userId: digestSettings.userId,
        maxItems: digestSettings.maxItems,
        minScore: digestSettings.minScore,
        ...preferenceColumns,
        timezone: plannerSettings.timezone,
        language: users.language,
        role: users.role,
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
      { kind: 'manual', emptyKey },
    );
  }

  // -------------------------------------------------------------------------
  // The funnel
  // -------------------------------------------------------------------------

  private async sendFor(
    user: DigestUser,
    slotKey: string,
    now: Date,
    /**
     * Which push this is, and the ingestion window it covers. A manual send has
     * no window and weighs the whole unsent fortnight; instant mode answers an
     * empty result with silence instead of "nothing today".
     */
    run: {
      kind: 'digest' | 'instant' | 'manual';
      window?: IngestWindow;
      emptyKey?: 'empty' | 'nothingNew';
    },
  ): Promise<number> {
    const instant = run.kind === 'instant';
    const language: Language = user.language === 'en' ? 'en' : 'ru';
    const basis = await this.matchBasis(user.userId, user.role);
    // A non-owner whose profile is not confirmed yet has nothing to match on.
    if (!basis) return 0;
    const candidates = (
      await this.collectCandidates(user.userId, now, basis, user.mutedSources, run.window)
    ).filter((candidate) => passesPreferences(user, candidate));
    if (candidates.length === 0) {
      if (!instant) await this.sendEmpty(user.userId, language, run.emptyKey);
      return 0;
    }

    const scored = this.scoreByFormula(candidates, basis, language, now);
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
      if (!instant) await this.sendEmpty(user.userId, language, run.emptyKey);
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
          keyboard: isLast && item.url ? renderKeyboard(item, language) : undefined,
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
    basis: MatchBasis,
    mutedSources: string[],
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
    const resumeLevel = basis.level;
    const tooJunior = resumeLevel ? levelsBelowResume(resumeLevel) : [];
    if (tooJunior.length > 0) {
      const clause = or(isNull(vacancies.seniority), notInArray(vacancies.seniority, tooJunior));
      if (clause) conditions.push(clause);
    }

    // Sources whose terms or nature keep them to the owner (the owner's own
    // LinkedIn alerts, roadmap 5.4) never reach anyone else — except the
    // vacancies a user's own forwarded alerts brought in (ADR-027).
    if (!basis.owner) {
      const clause = or(
        isNull(sources.slug),
        sql`not ${ownerOnlySource}`,
        addressedToUser(userId),
      );
      if (clause) conditions.push(clause);
    }

    // Sources switched off in /settings. Rows without a source pass.
    if (mutedSources.length > 0) {
      const clause = or(isNull(sources.slug), notInArray(sources.slug, mutedSources));
      if (clause) conditions.push(clause);
    }

    const relevance = lexicalRelevanceSql(basis.terms, vacancies.title, vacancies.description);
    const resumeId = basis.resumeId;

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
          eq(resumeMatches.resumeId, resumeId ?? NO_RESUME),
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

  /** What this user's send ranks against, or null when there is nothing yet. */
  private async matchBasis(userId: string, role: string): Promise<MatchBasis | null> {
    const owner = isOwnerRole(role as UserRole);
    const [stored] = await this.db
      .select({
        role: candidateProfiles.role,
        grade: candidateProfiles.grade,
        skills: candidateProfiles.skills,
        weights: candidateProfiles.feedbackWeights,
        confirmedAt: candidateProfiles.confirmedAt,
      })
      .from(candidateProfiles)
      .where(eq(candidateProfiles.userId, userId));

    if (!owner) {
      if (!stored?.confirmedAt) return null;
      const profile = scoringProfile(stored);
      return {
        owner,
        profile,
        weights: stored.weights,
        terms: profileTerms(profile),
        level: profile.grade,
        resumeId: null,
      };
    }

    // The owner never went through the bot's confirmation dialog: any stored
    // profile counts, and without one the resume's own terms stand in for it.
    const resume = await this.activeResume(userId);
    if (!stored && !resume) return null;
    const profile = stored ? scoringProfile(stored) : fallbackProfile(resume?.text ?? '');
    return {
      owner,
      profile,
      weights: stored?.weights ?? EMPTY_FEEDBACK,
      terms: resume ? extractResumeTerms(resume.text) : profileTerms(profile),
      level: profile.grade ?? (resume ? detectSeniority(resume.text) : null),
      resumeId: resume?.id ?? null,
    };
  }

  /** ADR-025 §5: the formula for every candidate, with its template explanation. */
  private scoreByFormula(
    candidates: DigestCandidate[],
    basis: MatchBasis,
    language: Language,
    now: Date,
  ): ScoredCandidate[] {
    return candidates.map((candidate) => {
      const result = scoreVacancy(basis.profile, candidate, { now, weights: basis.weights });
      return {
        ...candidate,
        score: result.score,
        note: explainScore(result, language),
        fit: { matched: result.matched, related: result.related, missing: result.missing, grade: result.grade },
      };
    });
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

  /** The scheduled digest's "nothing worth your attention" — the user is waiting for it. */
  private async sendEmpty(
    userId: string,
    language: string,
    key: 'empty' | 'nothingNew' = 'empty',
  ): Promise<number> {
    await this.bot.sendToUser(userId, digestText(language === 'en' ? 'en' : 'ru', key));
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
    if (action === DIGEST_ACTION.now) {
      this.startOnRequest(ctx.userId, ctx.role, ctx.language);
      return { alert: digestText(ctx.language, 'searching') };
    }
    if (!action || !vacancyId) return {};

    switch (action) {
      case DIGEST_ACTION.hide: {
        const inserted = await this.db
          .insert(hiddenVacancies)
          .values({ userId: ctx.userId, vacancyId })
          .onConflictDoNothing()
          .returning({ vacancyId: hiddenVacancies.vacancyId });
        if (inserted.length > 0) await this.learn(ctx, vacancyId, 'hide');
        return {
          alert: digestText(ctx.language, 'hidden'),
          editText: digestText(ctx.language, 'hidden'),
          editKeyboard: null,
        };
      }
      case DIGEST_ACTION.up:
      case DIGEST_ACTION.down: {
        const feedback = action === DIGEST_ACTION.up ? 1 : -1;
        const where = and(eq(digestItems.userId, ctx.userId), eq(digestItems.vacancyId, vacancyId));
        const [previous] = await this.db
          .select({ feedback: digestItems.feedback })
          .from(digestItems)
          .where(where);
        await this.db.update(digestItems).set({ feedback }).where(where);
        // A second press of the same button is not a second vote.
        if (previous?.feedback !== feedback) {
          await this.learn(ctx, vacancyId, feedback > 0 ? 'up' : 'down');
        }
        return { alert: digestText(ctx.language, feedback > 0 ? 'liked' : 'disliked') };
      }
      case DIGEST_ACTION.applied: {
        // New → applied, saved → applied, anything further along stays put.
        const { item } = await this.applications.markApplied(ctx.userId, vacancyId);
        return {
          alert: digestText(ctx.language, 'addedToApplications'),
          // A card sent before v2.5.1 loses its "✅ Applied" button: the alert
          // confirms the press, and the Apply link stays.
          editKeyboard: renderKeyboard({ url: item.vacancy.url, sourceSlug: item.vacancy.source }, ctx.language),
        };
      }
      default:
        return {};
    }
  }

  /**
   * Moves the formula's feedback weights for one press (ADR-025 §7). Needs a
   * stored profile, so an owner judged by the resume fallback learns nothing
   * until they have one; a failure here never fails the press, which has
   * already been recorded.
   */
  private async learn(ctx: BotCallbackContext, vacancyId: string, kind: FeedbackKind): Promise<void> {
    try {
      const [row] = await this.db
        .select({
          weights: candidateProfiles.feedbackWeights,
          skills: candidateProfiles.skills,
          company: vacancies.companyRaw,
          title: vacancies.title,
          description: vacancies.description,
        })
        .from(candidateProfiles)
        .innerJoin(vacancies, eq(vacancies.id, vacancyId))
        .where(eq(candidateProfiles.userId, ctx.userId));
      if (!row) return;

      const weights = applyFeedback(row.weights, {
        kind,
        company: row.company,
        vacancySkills: detectVacancySkills(row.title, row.description),
        coreSkills: coreSkillNames(row.skills),
      });
      await this.db
        .update(candidateProfiles)
        .set({ feedbackWeights: weights, updatedAt: new Date() })
        .where(eq(candidateProfiles.userId, ctx.userId));
    } catch (err) {
      this.logger.warn(
        `feedback weights not updated for user ${ctx.userId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

/** The columns of the /settings hard preferences, shared by every settings read. */
const preferenceColumns = {
  workFormats: digestSettings.workFormats,
  employmentTypes: digestSettings.employmentTypes,
  minSalaryUsd: digestSettings.minSalaryUsd,
  mutedSources: digestSettings.mutedSources,
  locations: digestSettings.locations,
};

/** A stored candidate profile as the formula reads it; an unknown grade reads as none. */
function scoringProfile(stored: {
  role: string | null;
  grade: string | null;
  skills: CandidateSkill[];
}): ScoringProfile {
  const grade = (SENIORITY_LEVELS as readonly string[]).includes(stored.grade ?? '')
    ? (stored.grade as SeniorityLevel)
    : null;
  return { role: stored.role, grade, skills: stored.skills };
}

function coreSkillNames(skills: CandidateSkill[]): string[] {
  return skills.filter((skill) => skill.weight === 'core').map((skill) => skill.name);
}

/**
 * The SQL pre-rank's terms for a profile: the job family's title words and the
 * spellings of the strongest skills, core first. Same shape the owner's resume
 * text produces, so one ordering query serves both.
 */
export function profileTerms(profile: ScoringProfile): ResumeTerms {
  const family = roleFamily(profile.role);
  const roles = ROLE_FAMILIES.find((entry) => entry.family === family)?.terms ?? [];
  const ordered = [
    ...profile.skills.filter((skill) => skill.weight === 'core'),
    ...profile.skills.filter((skill) => skill.weight !== 'core'),
  ];
  const keys = [...new Set(ordered.map((skill) => canonicalSkill(skill.name)))].slice(
    0,
    RESUME_STACK_LIMIT,
  );
  const stack = [...new Set(keys.flatMap((key) => skillTextPatterns(key)))];
  return { roles, stack };
}

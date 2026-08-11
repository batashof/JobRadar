import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BOT_CALLBACK_NAMESPACES,
  detectSeniority,
  type Language,
  PLANNER_DEFAULTS,
} from '@jobradar/shared';
import { and, desc, eq, gte, isNull, notExists, sql } from 'drizzle-orm';

import { type BotCallbackContext, type BotCallbackResult, BotService } from '../bot/bot.service';
import { DB, type Database } from '../db/db.module';
import {
  digestItems,
  digestSettings,
  hiddenVacancies,
  plannerSettings,
  profileMatches,
  resumes,
  searchProfiles,
  telegramAccounts,
  users,
  vacancies,
} from '../db/schema';
import { LlmService } from '../llm/llm.service';
import { resolveDue } from './due';
import { DIGEST_ACTION, digestText, renderCard, renderHeader, renderKeyboard } from './render';
import {
  buildBatchPrompt,
  type DigestCandidate,
  dropTooJunior,
  fallbackScores,
  parseBatchReply,
  type ScoredCandidate,
  shortlist,
} from './select';

/** How many candidates the LLM ranks in one call. Above this the prompt bloats. */
const BATCH_LIMIT = 30;

/** How far back to look for unsent vacancies — older ones are not news. */
const CANDIDATE_WINDOW_DAYS = 14;

export interface DigestRunResult {
  users: number;
  sent: number;
  vacancies: number;
  skipped: number;
}

/**
 * The digest itself: pick, score, send. Reads `digest_settings` for the
 * schedule (ADR-015 §7 timezone), the bot channel for delivery, and writes
 * `digest_items` so a vacancy is never pushed twice.
 *
 * Cost discipline (ADR-005): SQL narrows to vacancies that already pass
 * rules-based profile matching and were never sent, then **one** LLM call ranks
 * up to 30 of them. With no LLM key the run still happens, ordered by the
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
        timezone: plannerSettings.timezone,
        language: users.language,
      })
      .from(digestSettings)
      .innerJoin(users, eq(users.id, digestSettings.userId))
      .leftJoin(plannerSettings, eq(plannerSettings.userId, digestSettings.userId))
      .innerJoin(telegramAccounts, eq(telegramAccounts.userId, digestSettings.userId))
      .where(and(eq(digestSettings.enabled, true), sql`${telegramAccounts.chatId} is not null`));

    const result: DigestRunResult = { users: rows.length, sent: 0, vacancies: 0, skipped: 0 };

    for (const row of rows) {
      try {
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

        const count = await this.sendFor(
          { ...row, timezone: row.timezone ?? PLANNER_DEFAULTS.timezone },
          due.key,
          now,
        );
        await this.markSent(row.userId, due.key);
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

    if (result.sent || result.skipped) {
      this.logger.log(
        `digest: ${result.sent} send(s), ${result.vacancies} vacancies, ${result.skipped} stale slot(s)`,
      );
    }
    return result;
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

    return this.sendFor(
      { ...row, timezone: row.timezone ?? PLANNER_DEFAULTS.timezone },
      `manual ${now.toISOString()}`,
      now,
    );
  }

  // -------------------------------------------------------------------------
  // The funnel
  // -------------------------------------------------------------------------

  private async sendFor(
    user: {
      userId: string;
      maxItems: number;
      minScore: number;
      timezone: string;
      language: string;
    },
    slotKey: string,
    now: Date,
  ): Promise<number> {
    const language: Language = user.language === 'en' ? 'en' : 'ru';
    const resumeText = await this.activeResumeText(user.userId);
    const candidates = await this.collectCandidates(user.userId, now, resumeText);
    if (candidates.length === 0) {
      await this.bot.sendToUser(user.userId, digestText(language, 'empty'));
      return 0;
    }

    const scored = await this.score(user.userId, candidates, resumeText, language);
    const picked = shortlist(scored, user.maxItems, user.minScore);
    if (picked.length === 0) {
      await this.bot.sendToUser(user.userId, digestText(language, 'empty'));
      return 0;
    }

    await this.bot.sendToUser(user.userId, renderHeader(language, picked.length), {
      parseMode: 'HTML',
      disablePreview: true,
    });

    for (const item of picked) {
      const messageId = await this.bot.sendToUser(user.userId, renderCard(item, language), {
        parseMode: 'HTML',
        disablePreview: true,
        keyboard: renderKeyboard(item, language, this.webOrigin),
      });
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
   * Vacancies that pass the user's rules-based matching, are canonical, are not
   * hidden, and were never sent to them — newest first. This is the cheap stage
   * and it does all the narrowing it can before any token is spent.
   */
  private async collectCandidates(
    userId: string,
    now: Date,
    resumeText: string | null,
  ): Promise<DigestCandidate[]> {
    const since = new Date(now.getTime() - CANDIDATE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const rows = await this.db
      .selectDistinctOn([vacancies.id], {
        id: vacancies.id,
        title: vacancies.title,
        company: vacancies.companyRaw,
        description: vacancies.description,
        location: vacancies.location,
        seniority: vacancies.seniority,
        salaryMin: vacancies.salaryMin,
        salaryMax: vacancies.salaryMax,
        salaryCurrency: vacancies.salaryCurrency,
        url: vacancies.url,
        publishedAt: vacancies.publishedAt,
        ruleScore: profileMatches.score,
      })
      .from(profileMatches)
      .innerJoin(searchProfiles, eq(searchProfiles.id, profileMatches.profileId))
      .innerJoin(vacancies, eq(vacancies.id, profileMatches.vacancyId))
      .where(
        and(
          eq(searchProfiles.userId, userId),
          eq(searchProfiles.isActive, true),
          isNull(vacancies.canonicalVacancyId),
          gte(vacancies.ingestedAt, since),
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(digestItems)
              .where(
                and(eq(digestItems.userId, userId), eq(digestItems.vacancyId, vacancies.id)),
              ),
          ),
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(hiddenVacancies)
              .where(
                and(
                  eq(hiddenVacancies.userId, userId),
                  eq(hiddenVacancies.vacancyId, vacancies.id),
                ),
              ),
          ),
        ),
      )
      .orderBy(vacancies.id);

    // Rules-based level gate before any token is spent (ADR-012): a push has no
    // room for roles the user has clearly outgrown.
    const filtered = dropTooJunior(rows, resumeText ? detectSeniority(resumeText) : null);

    // Best rules score first, then freshness — the LLM only sees the top slice.
    return filtered
      .sort(
        (a, b) =>
          b.ruleScore - a.ruleScore ||
          (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
      )
      .slice(0, BATCH_LIMIT);
  }

  private async activeResumeText(userId: string): Promise<string | null> {
    const [resume] = await this.db
      .select({ text: resumes.extractedText })
      .from(resumes)
      .where(and(eq(resumes.userId, userId), eq(resumes.isActive, true)))
      .orderBy(desc(resumes.uploadedAt))
      .limit(1);
    return resume?.text ?? null;
  }

  /** One LLM call for the whole batch; deterministic ordering when it cannot run. */
  private async score(
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
      const reply = await this.llm.complete({ ...prompt, maxTokens: 1600, temperature: 0.2 });
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

  private async markSent(userId: string, key: string): Promise<void> {
    await this.db
      .update(digestSettings)
      .set({ lastSentKey: key, updatedAt: new Date() })
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

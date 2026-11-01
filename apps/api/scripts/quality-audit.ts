/**
 * Daily delivery quality audit (ADR-035). Replays the digest funnel for the
 * author over every vacancy that arrived in the last N hours, has a free LLM
 * judge a sample of them, and reports what was sent but is not a fit and what
 * was held back but is one. With --apply it writes the dictionary words the
 * judge's clear cases call for (title-terms.json + title-cases.json); the
 * "Quality audit" workflow then tests them and opens a pull request.
 *
 * Read-only on the database. Inputs (all optional except the DB with --prod):
 *   DATABASE_URL_PROD (+ DATABASE_CA_CERT_PROD)   with --prod
 *   GITHUB_TOKEN                                  GitHub Models (models: read)
 *   GROQ_API_KEY / GEMINI_API_KEY / OPENROUTER_API_KEY   fallback judges
 *   TELEGRAM_BOT_TOKEN                            the summary to the author's chat
 *   AUDIT_USER_ID                                 whose delivery to audit (default: the owner)
 *
 * Usage: pnpm --filter @jobradar/api audit:quality [--prod] [--apply] [--hours=24] [--budget=120]
 * Writes audit-out/report.md, audit-out/summary.json and, with fixes, audit-out/pr-body.md.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIGEST_DEFAULTS, type SeniorityLevel, SENIORITY_LEVELS } from '@jobradar/shared';
import { config } from 'dotenv';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';

import { type AuditVacancy, decide, pickForJudging } from '../src/audit/decide';
import { applyTermFixes, findIssues, proposeTermFixes, type TitleCase } from '../src/audit/findings';
import { buildJudgeMessages, callJudge, JUDGE_BATCH, judgeProviders, parseVerdicts, type Verdict } from '../src/audit/judge';
import { type AuditSummary, renderPrBody, renderReport, renderTelegram } from '../src/audit/report';
import { fallbackProfile } from '../src/candidate/analysis';
import { ownerChats, sendTelegramMessage } from '../src/common/owner-telegram';
import { openScriptDb } from '../src/db/prod-db';
import {
  candidateProfiles,
  digestItems,
  digestSettings,
  resumes,
  sources,
  telegramAccounts,
  users,
  vacancies,
} from '../src/db/schema';
import { EMPTY_FEEDBACK, roleFamily, type ScoringProfile, TITLE_TERMS } from '../src/matching/score';
import { detectVacancyLanguages } from '../src/matching/work-language';

config({ path: '../../.env' });

const DICTIONARY_DIR = join(__dirname, '../src/matching/dictionaries');
const OUT_DIR = join(__dirname, '../audit-out');
/** GitHub Models' free tier allows about 15 requests a minute; stay under it. */
const PAUSE_MS = 5_000;

function arg(name: string, fallback: number): number {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  const value = found ? Number(found.split('=')[1]) : NaN;
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const prod = process.argv.includes('--prod');
  const apply = process.argv.includes('--apply');
  const hours = arg('hours', 24);
  const budget = arg('budget', 120);
  const now = new Date();
  const { db, close } = openScriptDb(prod);
  try {
    // The author: an owner account, the one with the most deliveries
    // (every pre-bot account became an owner, test accounts included).
    const sent = sql<number>`(select count(*) from ${digestItems} where ${digestItems.userId} = ${users.id})::int`;
    const [owner] = await db
      .select({ id: users.id, chatId: telegramAccounts.chatId, sent })
      .from(users)
      .innerJoin(telegramAccounts, eq(telegramAccounts.userId, users.id))
      .where(process.env.AUDIT_USER_ID ? eq(users.id, process.env.AUDIT_USER_ID) : eq(users.role, 'owner'))
      .orderBy(desc(sent))
      .limit(1);
    if (!owner) throw new Error('no owner with a linked Telegram chat');

    const [stored] = await db
      .select({
        role: candidateProfiles.role,
        grade: candidateProfiles.grade,
        skills: candidateProfiles.skills,
        weights: candidateProfiles.feedbackWeights,
      })
      .from(candidateProfiles)
      .where(eq(candidateProfiles.userId, owner.id));
    let profile: ScoringProfile;
    if (stored) {
      const grade = (SENIORITY_LEVELS as readonly string[]).includes(stored.grade ?? '')
        ? (stored.grade as SeniorityLevel)
        : null;
      profile = { role: stored.role, grade, skills: stored.skills };
    } else {
      const [resume] = await db
        .select({ text: resumes.extractedText })
        .from(resumes)
        .where(and(eq(resumes.userId, owner.id), eq(resumes.isActive, true)))
        .orderBy(desc(resumes.uploadedAt))
        .limit(1);
      if (!resume) throw new Error('the owner has neither a profile nor a resume');
      profile = fallbackProfile(resume.text);
    }

    const [settings] = await db.select().from(digestSettings).where(eq(digestSettings.userId, owner.id));
    const prefs = {
      workFormats: settings?.workFormats ?? [],
      employmentTypes: settings?.employmentTypes ?? [],
      minSalaryUsd: settings?.minSalaryUsd ?? null,
      locations: settings?.locations ?? [],
      workLanguages: settings?.workLanguages ?? ['en', 'ru', 'uk'],
    };
    const minScore = settings?.minScore ?? DIGEST_DEFAULTS.minScore;
    const muted = new Set(settings?.mutedSources ?? []);

    const since = new Date(now.getTime() - hours * 3_600_000);
    const rows = await db
      .select({
        id: vacancies.id,
        title: vacancies.title,
        company: vacancies.companyRaw,
        description: vacancies.description,
        url: vacancies.url,
        sourceSlug: sources.slug,
        location: vacancies.location,
        seniority: vacancies.seniority,
        salaryMin: vacancies.salaryMin,
        salaryMax: vacancies.salaryMax,
        salaryCurrency: vacancies.salaryCurrency,
        workFormat: vacancies.workFormat,
        employmentType: vacancies.employmentType,
        publishedAt: vacancies.publishedAt,
      })
      .from(vacancies)
      .leftJoin(sources, eq(sources.id, vacancies.sourceId))
      .where(and(isNull(vacancies.canonicalVacancyId), gte(vacancies.ingestedAt, since)));

    const pool: AuditVacancy[] = rows
      .filter((row) => !row.sourceSlug || !muted.has(row.sourceSlug))
      .map((row) => ({ ...row, languages: detectVacancyLanguages(row, row.sourceSlug === 'linkedin') }));
    const decisions = decide(
      { profile, weights: stored?.weights ?? EMPTY_FEEDBACK, prefs, minScore, now },
      pool,
    );
    console.log(`${decisions.length} vacancies in ${hours} h, ${decisions.filter((d) => d.delivered).length} delivered`);

    // The judge, in batches, down the free-tier failover chain.
    const picked = pickForJudging(decisions, budget, minScore);
    const providers = judgeProviders(process.env);
    const dead = new Set<string>();
    const used = new Set<string>();
    const verdicts = new Map<string, Verdict>();
    for (let i = 0; i < picked.length; i += JUDGE_BATCH) {
      const batch = picked.slice(i, i + JUDGE_BATCH).map((d) => d.vacancy);
      const answer = await callJudge(buildJudgeMessages(profile, batch), providers, dead);
      if (!answer) {
        console.warn('every judge failed; stopping early');
        break;
      }
      used.add(answer.provider);
      for (const verdict of parseVerdicts(answer.content, batch.map((v) => v.id))) verdicts.set(verdict.id, verdict);
      if (i + JUDGE_BATCH < picked.length) await sleep(PAUSE_MS);
    }
    const judged = decisions.flatMap((decision) => {
      const verdict = verdicts.get(decision.vacancy.id);
      return verdict ? [{ decision, verdict }] : [];
    });

    const findings = findIssues(roleFamily(profile.role), judged);
    const cases = JSON.parse(readFileSync(join(DICTIONARY_DIR, 'title-cases.json'), 'utf8')) as TitleCase[];
    const { fixes, rejected } = proposeTermFixes(findings, TITLE_TERMS, cases, judged);

    const runUrl = process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : undefined;
    const summary: AuditSummary = {
      hours,
      decisions,
      judged,
      unjudged: decisions.length - judged.length,
      providers: [...used],
      findings,
      fixes,
      rejected,
      runUrl,
    };

    const report = renderReport(summary);
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, 'report.md'), report);
    writeFileSync(
      join(OUT_DIR, 'summary.json'),
      JSON.stringify(
        {
          vacancies: decisions.length,
          delivered: decisions.filter((d) => d.delivered).length,
          judged: judged.length,
          providers: [...used],
          findings: findings.map((f) => ({
            kind: f.kind,
            cause: f.cause,
            id: f.decision.vacancy.id,
            title: f.decision.vacancy.title,
            url: f.decision.vacancy.url,
            score: f.decision.score,
            reason: f.decision.reason,
            verdict: f.verdict,
          })),
          fixes,
          rejected,
        },
        null,
        2,
      ),
    );
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
    console.log(report);

    if (apply && fixes.length > 0) {
      const next = applyTermFixes(TITLE_TERMS, cases, fixes);
      writeFileSync(join(DICTIONARY_DIR, 'title-terms.json'), `${JSON.stringify(next.terms, null, 2)}\n`);
      writeFileSync(join(DICTIONARY_DIR, 'title-cases.json'), `${JSON.stringify(next.cases, null, 2)}\n`);
      writeFileSync(join(OUT_DIR, 'pr-body.md'), renderPrBody(summary));
      console.log(`applied ${fixes.length} dictionary fix(es)`);
    }

    // The summary goes to every owner chat, like the bot's own owner notices:
    // the audited account (most deliveries) may not be the chat the author
    // reads, e.g. after /testmode.
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.log('telegram: TELEGRAM_BOT_TOKEN is not set, summary not sent');
    } else {
      const chats = await ownerChats(db);
      if (chats.length === 0) console.warn('telegram: no owner has a linked chat, summary not sent');
      for (const chat of chats) {
        const error = await sendTelegramMessage(token, { chat_id: chat.chatId, text: renderTelegram(summary) });
        console.log(`telegram: summary to chat ${chat.chatId}: ${error ?? 'sent'}`);
      }
    }
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

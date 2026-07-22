import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ApplyContact,
  ApplyEmailDraft,
  ApplyEmailSendInput,
  ApplyEmailSendResult,
  BriefResponse,
  CoverLetterResponse,
  Language,
  ResumeMatchResponse,
} from '@jobradar/shared';
import { and, eq, sql } from 'drizzle-orm';

import { DB, type Database } from '../db/db.module';
import { applications, outreachEmails, resumeMatches, users, vacancies } from '../db/schema';
import { LlmService } from '../llm/llm.service';
import { buildResumeMatchPrompt, parseResumeMatchReply } from '../matching/resume-match';
import { ResumesService } from '../resumes/resumes.service';
import { GmailService } from './gmail.service';
import {
  buildApplyEmailPrompt,
  buildBriefPrompt,
  buildCoverLetterPrompt,
  parseApplyEmail,
  type VacancyPromptInput,
} from './prompts';

@Injectable()
export class OutreachService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly llm: LlmService,
    private readonly resumes: ResumesService,
    private readonly gmail: GmailService,
  ) {}

  /**
   * Vacancy brief in the user's language — generated on demand, cached
   * permanently per language on the vacancy row (ADR-005/014). `force`
   * regenerates the requested language's slot.
   */
  async brief(
    userId: string,
    vacancyId: string,
    lang: Language = 'ru',
    force = false,
  ): Promise<BriefResponse> {
    const vacancy = await this.loadVacancy(vacancyId);

    const cachedText = lang === 'en' ? vacancy.summaryEn : vacancy.summaryRu;
    const cachedAt = lang === 'en' ? vacancy.summaryEnGeneratedAt : vacancy.summaryGeneratedAt;
    if (cachedText && cachedAt && !force) {
      return { summary: cachedText, generatedAt: cachedAt.toISOString(), cached: true };
    }

    const resume = await this.resumes.getActive(userId);
    const prompt = buildBriefPrompt(vacancy, resume?.extractedText || null, lang);
    const result = await this.llm.complete({ ...prompt, maxTokens: 700 });

    const generatedAt = new Date();
    await this.db
      .update(vacancies)
      .set(
        lang === 'en'
          ? { summaryEn: result.text, summaryEnGeneratedAt: generatedAt }
          : { summaryRu: result.text, summaryGeneratedAt: generatedAt },
      )
      .where(eq(vacancies.id, vacancyId));

    return { summary: result.text, generatedAt: generatedAt.toISOString(), cached: false };
  }

  /** Cover letter grounded in the active resume — not cached, user edits before use. */
  async coverLetter(userId: string, vacancyId: string): Promise<CoverLetterResponse> {
    const vacancy = await this.loadVacancy(vacancyId);

    const resume = await this.resumes.getActive(userId);
    if (!resume) {
      throw new BadRequestException('Upload a resume first — the letter is built from it');
    }
    if (!resume.extractedText) {
      throw new BadRequestException(
        'No text could be extracted from the active resume — upload a text-based PDF',
      );
    }

    const prompt = buildCoverLetterPrompt(vacancy, resume.extractedText);
    const result = await this.llm.complete({ ...prompt, maxTokens: 600, temperature: 0.5 });
    return { coverLetter: result.text };
  }

  /**
   * On-demand LLM resume-fit score for one vacancy (ADR-012). The score is
   * cached permanently in `resume_matches`; the rationale is cached per language
   * (ADR-014). A repeat click in a language already generated is free; the first
   * click in the other language reuses the score and only regenerates the text.
   */
  async resumeMatch(
    userId: string,
    vacancyId: string,
    lang: Language = 'ru',
  ): Promise<ResumeMatchResponse> {
    const vacancy = await this.loadVacancy(vacancyId);

    const resume = await this.resumes.getActive(userId);
    if (!resume) {
      throw new BadRequestException('Upload a resume first — the score is built from it');
    }
    if (!resume.extractedText) {
      throw new BadRequestException(
        'No text could be extracted from the active resume — upload a text-based PDF',
      );
    }

    const [cached] = await this.db
      .select({
        score: resumeMatches.score,
        explanation: resumeMatches.explanation,
        explanationEn: resumeMatches.explanationEn,
      })
      .from(resumeMatches)
      .where(and(eq(resumeMatches.resumeId, resume.id), eq(resumeMatches.vacancyId, vacancyId)));

    if (cached) {
      const localized = lang === 'en' ? cached.explanationEn : cached.explanation;
      if (localized) {
        return { score: cached.score, explanation: localized, cached: true };
      }
      // Score already known, just this language's rationale is missing.
      const explanation = await this.generateMatchExplanation(vacancy, resume.extractedText, lang);
      await this.db
        .update(resumeMatches)
        .set(lang === 'en' ? { explanationEn: explanation } : { explanation })
        .where(and(eq(resumeMatches.resumeId, resume.id), eq(resumeMatches.vacancyId, vacancyId)));
      return { score: cached.score, explanation, cached: false };
    }

    const prompt = buildResumeMatchPrompt(vacancy, resume.extractedText, lang);
    const result = await this.llm.complete({ ...prompt, maxTokens: 300, temperature: 0.2 });
    const parsed = parseResumeMatchReply(result.text);
    if (!parsed) {
      throw new BadRequestException('Could not score this vacancy — please try again');
    }

    await this.db
      .insert(resumeMatches)
      .values({
        resumeId: resume.id,
        vacancyId,
        score: parsed.score,
        explanation: lang === 'en' ? '' : parsed.explanation,
        explanationEn: lang === 'en' ? parsed.explanation : '',
      })
      .onConflictDoNothing();

    return { score: parsed.score, explanation: parsed.explanation, cached: false };
  }

  /** Generates just the fit rationale in the requested language (score reused). */
  private async generateMatchExplanation(
    vacancy: VacancyPromptInput,
    resumeText: string,
    lang: Language,
  ): Promise<string> {
    const prompt = buildResumeMatchPrompt(vacancy, resumeText, lang);
    const result = await this.llm.complete({ ...prompt, maxTokens: 300, temperature: 0.2 });
    const parsed = parseResumeMatchReply(result.text);
    if (!parsed) {
      throw new BadRequestException('Could not score this vacancy — please try again');
    }
    return parsed.explanation;
  }

  /**
   * LLM-drafted application email (subject + body around the user's cover
   * letter). Nothing is sent here — the user reviews and confirms in the UI.
   */
  async draftApplyEmail(
    userId: string,
    vacancyId: string,
    coverLetter: string,
  ): Promise<ApplyEmailDraft> {
    const vacancy = await this.loadVacancy(vacancyId);
    const [user] = await this.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId));
    const candidateEmail = user?.email ?? '';

    const contact = vacancy.applyContact as ApplyContact | null;
    const recipient = contact?.kind === 'email' ? contact.value : '';

    const prompt = buildApplyEmailPrompt(vacancy, coverLetter, candidateEmail);
    const result = await this.llm.complete({ ...prompt, maxTokens: 700 });
    const parsed = parseApplyEmail(result.text);
    if (parsed) return { recipient, ...parsed };

    // The model ignored the format — still give the user something sendable.
    return {
      recipient,
      subject: `${vacancy.title} — application`,
      body: `${coverLetter}\n\nMy resume is attached as a PDF.`,
    };
  }

  /** Sends the confirmed email via Gmail, records it, and updates the kanban. */
  async sendApplyEmail(
    userId: string,
    vacancyId: string,
    input: ApplyEmailSendInput,
  ): Promise<ApplyEmailSendResult> {
    await this.loadVacancy(vacancyId); // 404 before any side effect

    const active = await this.resumes.getActive(userId);
    if (!active) {
      throw new BadRequestException('Upload a resume first — it is attached to the email');
    }
    const { filename, file } = await this.resumes.getFile(userId, active.id);

    const gmailMessageId = await this.gmail.sendEmail(userId, {
      to: input.recipient,
      subject: input.subject,
      bodyText: input.body,
      attachment: { filename, contentType: 'application/pdf', content: file },
    });

    const [outreach] = await this.db
      .insert(outreachEmails)
      .values({
        userId,
        vacancyId,
        resumeId: active.id,
        recipient: input.recipient,
        subject: input.subject,
        body: input.body,
        gmailMessageId,
      })
      .returning({ id: outreachEmails.id, sentAt: outreachEmails.sentAt });
    if (!outreach) throw new Error('Outreach insert returned no row');

    await this.reflectOnBoard(userId, vacancyId);

    return {
      outreachId: outreach.id,
      gmailMessageId,
      sentAt: outreach.sentAt.toISOString(),
    };
  }

  /** A sent application means the vacancy is at least in the "applied" stage. */
  private async reflectOnBoard(userId: string, vacancyId: string): Promise<void> {
    const now = new Date();
    const [existing] = await this.db
      .select({ id: applications.id, stage: applications.stage })
      .from(applications)
      .where(and(eq(applications.userId, userId), eq(applications.vacancyId, vacancyId)));

    if (!existing) {
      await this.db.insert(applications).values({
        userId,
        vacancyId,
        stage: 'applied',
        furthestStage: 'applied',
        appliedAt: now,
        lastActivityAt: now,
      });
      return;
    }
    if (existing.stage === 'saved') {
      await this.db
        .update(applications)
        .set({
          stage: 'applied',
          // 'applied' is the funnel floor; anything further was already recorded.
          furthestStage: sql`greatest(${applications.furthestStage}, 'applied'::application_stage)`,
          appliedAt: now,
          lastActivityAt: now,
          updatedAt: now,
        })
        .where(eq(applications.id, existing.id));
      return;
    }
    await this.db
      .update(applications)
      .set({ lastActivityAt: now, updatedAt: now })
      .where(eq(applications.id, existing.id));
  }

  private async loadVacancy(id: string): Promise<
    VacancyPromptInput & {
      summaryRu: string | null;
      summaryGeneratedAt: Date | null;
      summaryEn: string | null;
      summaryEnGeneratedAt: Date | null;
      applyContact: unknown;
    }
  > {
    const [row] = await this.db
      .select({
        title: vacancies.title,
        company: vacancies.companyRaw,
        description: vacancies.description,
        location: vacancies.location,
        summaryRu: vacancies.summaryRu,
        summaryGeneratedAt: vacancies.summaryGeneratedAt,
        summaryEn: vacancies.summaryEn,
        summaryEnGeneratedAt: vacancies.summaryEnGeneratedAt,
        applyContact: vacancies.applyContact,
      })
      .from(vacancies)
      .where(eq(vacancies.id, id));
    if (!row) throw new NotFoundException('Vacancy not found');
    return row;
  }
}

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { BriefResponse, CoverLetterResponse } from '@jobradar/shared';
import { eq } from 'drizzle-orm';

import { DB, type Database } from '../db/db.module';
import { vacancies } from '../db/schema';
import { LlmService } from '../llm/llm.service';
import { ResumesService } from '../resumes/resumes.service';
import { buildBriefPrompt, buildCoverLetterPrompt, type VacancyPromptInput } from './prompts';

@Injectable()
export class OutreachService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly llm: LlmService,
    private readonly resumes: ResumesService,
  ) {}

  /**
   * Russian brief for the vacancy — generated on demand, cached permanently on
   * the vacancy row (ADR-005 token discipline). `force` regenerates.
   */
  async brief(userId: string, vacancyId: string, force = false): Promise<BriefResponse> {
    const vacancy = await this.loadVacancy(vacancyId);

    if (vacancy.summaryRu && vacancy.summaryGeneratedAt && !force) {
      return {
        summaryRu: vacancy.summaryRu,
        generatedAt: vacancy.summaryGeneratedAt.toISOString(),
        cached: true,
      };
    }

    const resume = await this.resumes.getActive(userId);
    const prompt = buildBriefPrompt(vacancy, resume?.extractedText || null);
    const result = await this.llm.complete({ ...prompt, maxTokens: 700 });

    const generatedAt = new Date();
    await this.db
      .update(vacancies)
      .set({ summaryRu: result.text, summaryGeneratedAt: generatedAt })
      .where(eq(vacancies.id, vacancyId));

    return { summaryRu: result.text, generatedAt: generatedAt.toISOString(), cached: false };
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

  private async loadVacancy(
    id: string,
  ): Promise<VacancyPromptInput & { summaryRu: string | null; summaryGeneratedAt: Date | null }> {
    const [row] = await this.db
      .select({
        title: vacancies.title,
        company: vacancies.companyRaw,
        description: vacancies.description,
        location: vacancies.location,
        summaryRu: vacancies.summaryRu,
        summaryGeneratedAt: vacancies.summaryGeneratedAt,
      })
      .from(vacancies)
      .where(eq(vacancies.id, id));
    if (!row) throw new NotFoundException('Vacancy not found');
    return row;
  }
}

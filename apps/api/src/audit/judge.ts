import { z } from 'zod';

import { reasoningParams } from '../llm/llm.service';
import { type ScoringProfile } from '../matching/score';
import { type AuditVacancy } from './decide';

/**
 * The LLM as an offline judge of the formula (ADR-035), like `formula:check`
 * (ADR-026): it labels vacancies, it never decides a delivery. Its answer is
 * validated here and every change it leads to is made by code and checked by
 * tests. Only public vacancy text and the owner's structured profile (role,
 * grade, skills) are sent: no resume text, no name, no contacts.
 */

/** Families the judge may name; "other" for anything outside the dictionary. */
export const JUDGE_FAMILIES = [
  'frontend', 'fullstack', 'backend', 'mobile', 'devops', 'qa', 'data', 'design', 'product', 'analytics',
  'seo', 'marketing', 'content', 'sales', 'hr', 'support', 'management', 'other',
] as const;

/** Vacancies per request: small enough for an 8k-token free-tier request. */
export const JUDGE_BATCH = 8;
/** Characters of a description the judge reads. */
export const JUDGE_DESCRIPTION_CHARS = 700;

const verdictSchema = z.object({
  id: z.string(),
  engineering: z.boolean(),
  family: z.string(),
  fit: z.coerce.number().min(0).max(100),
  language: z.string().max(12).default(''),
  titleKeyword: z.string().max(60).nullable().default(null),
  reason: z.string().max(300).default(''),
});

export type Verdict = z.infer<typeof verdictSchema> & { family: (typeof JUDGE_FAMILIES)[number] };

export function buildJudgeMessages(
  profile: ScoringProfile,
  batch: AuditVacancy[],
): { role: 'system' | 'user'; content: string }[] {
  const candidate = {
    role: profile.role,
    grade: profile.grade,
    skills: profile.skills.map((skill) => `${skill.name}${skill.weight === 'core' ? ' (core)' : ''}`),
  };
  const vacancies = batch.map((v) => ({
    id: v.id,
    title: v.title,
    company: v.company,
    location: v.location,
    description: v.description.slice(0, JUDGE_DESCRIPTION_CHARS),
  }));
  return [
    {
      role: 'system',
      content: [
        'You review a job-matching engine. For every vacancy decide, from what the job is day to day:',
        '- engineering: true if the job is software engineering (writing code), false otherwise;',
        `- family: one of ${JUDGE_FAMILIES.join(', ')};`,
        '- fit: 0..100, how well the job suits the candidate. Judge the essence of the role, not keyword overlap:',
        '  a fullstack or backend role that merely lists React is a poor fit for a frontend candidate;',
        '- language: ISO 639-1 code of the language the work is done in;',
        '- titleKeyword: for a non-engineering job, the shortest word or phrase OF THE TITLE that names the',
        '  profession (e.g. "seo" in "Senior SEO Specialist"), copied as written; otherwise null;',
        '- reason: one short sentence.',
        'Answer with JSON only: {"verdicts":[{"id","engineering","family","fit","language","titleKeyword","reason"}]}.',
      ].join('\n'),
    },
    { role: 'user', content: JSON.stringify({ candidate, vacancies }) },
  ];
}

/**
 * The verdicts of one answer, keeping only well-formed ones for vacancies that
 * were asked about. A model that wraps its JSON in prose or a code fence is
 * read anyway; anything else is dropped, never guessed.
 */
export function parseVerdicts(content: string, askedIds: string[]): Verdict[] {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.slice(start, end + 1));
  } catch {
    return [];
  }
  const list = (parsed as { verdicts?: unknown }).verdicts;
  if (!Array.isArray(list)) return [];
  const asked = new Set(askedIds);
  const seen = new Set<string>();
  const verdicts: Verdict[] = [];
  for (const item of list) {
    const result = verdictSchema.safeParse(item);
    if (!result.success || !asked.has(result.data.id) || seen.has(result.data.id)) continue;
    seen.add(result.data.id);
    const family = (JUDGE_FAMILIES as readonly string[]).includes(result.data.family.toLowerCase())
      ? (result.data.family.toLowerCase() as Verdict['family'])
      : 'other';
    const keyword = result.data.titleKeyword?.trim().toLowerCase() || null;
    verdicts.push({
      ...result.data,
      family,
      fit: Math.round(result.data.fit),
      language: result.data.language.trim().toLowerCase(),
      titleKeyword: keyword,
    });
  }
  return verdicts;
}

// ---------------------------------------------------------------------------
// Providers: free tiers only (ADR-001), all OpenAI-compatible
// ---------------------------------------------------------------------------

export interface JudgeProvider {
  name: string;
  url: string;
  key: string;
  model: string;
  /** Extra request headers the provider wants. */
  headers?: Record<string, string>;
}

/**
 * GitHub Models first: free in Actions with the workflow's own token
 * (`permissions: models: read`), no extra secret. The app's free LLM keys are
 * the fallback, in the order the API uses them (ADR-005).
 */
export function judgeProviders(env: NodeJS.ProcessEnv): JudgeProvider[] {
  const all: (JudgeProvider | null)[] = [
    env.GITHUB_TOKEN
      ? {
          name: 'github-models',
          url: 'https://models.github.ai/inference/chat/completions',
          key: env.GITHUB_TOKEN,
          model: env.AUDIT_GITHUB_MODEL || 'openai/gpt-4.1-mini',
          // On 2026-10-30 this endpoint answered a plain-text "OK" from
          // Actions, with and without these headers; such an answer now falls
          // over to the app's own free keys.
          headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        }
      : null,
    env.GROQ_API_KEY
      ? {
          name: 'groq',
          url: 'https://api.groq.com/openai/v1/chat/completions',
          key: env.GROQ_API_KEY,
          model: env.GROQ_MODEL || 'openai/gpt-oss-120b',
        }
      : null,
    env.GEMINI_API_KEY
      ? {
          name: 'gemini',
          url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
          key: env.GEMINI_API_KEY,
          model: env.GEMINI_MODEL || 'gemini-flash-latest',
        }
      : null,
    env.OPENROUTER_API_KEY
      ? {
          name: 'openrouter',
          url: 'https://openrouter.ai/api/v1/chat/completions',
          key: env.OPENROUTER_API_KEY,
          model: env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
        }
      : null,
  ];
  return all.filter((provider): provider is JudgeProvider => provider !== null);
}

export interface JudgeCall {
  content: string;
  provider: string;
}

/**
 * One request down the failover chain. A provider that fails (quota, outage,
 * bad answer) is skipped for the rest of the run, so a spent daily quota costs
 * one failed request, not one per batch.
 */
export async function callJudge(
  messages: { role: string; content: string }[],
  providers: JudgeProvider[],
  dead: Set<string>,
  fetchImpl: typeof fetch = fetch,
): Promise<JudgeCall | null> {
  for (const provider of providers) {
    if (dead.has(provider.name)) continue;
    try {
      const res = await fetchImpl(provider.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${provider.key}`,
          'Content-Type': 'application/json',
          ...provider.headers,
        },
        body: JSON.stringify({
          model: provider.model,
          messages,
          temperature: 0,
          max_tokens: 2500,
          response_format: { type: 'json_object' },
          ...(reasoningParams(provider.name, provider.model) ?? {}),
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 200);
        console.warn(`judge ${provider.name}: HTTP ${res.status} ${detail}`);
        dead.add(provider.name);
        continue;
      }
      const raw = await res.text();
      let content: string | undefined;
      try {
        const body = JSON.parse(raw) as { choices?: { message?: { content?: string } }[] };
        content = body.choices?.[0]?.message?.content;
      } catch {
        content = undefined;
      }
      if (!content) {
        const type = res.headers.get('content-type') ?? '-';
        console.warn(`judge ${provider.name}: no answer (${type}) ${raw.slice(0, 200)}`);
        dead.add(provider.name);
        continue;
      }
      return { content, provider: provider.name };
    } catch (error) {
      console.warn(`judge ${provider.name}: ${error instanceof Error ? error.message : error}`);
      dead.add(provider.name);
    }
  }
  return null;
}

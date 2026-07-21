/**
 * Prompt builders and reply parsers for the interview-prep module (ADR-013).
 * Pure functions so tests pin the contracts without an LLM. Inputs are
 * truncated here (token discipline, ADR-005).
 */
import type {
  InterviewFeedback,
  InterviewPlanStructure,
  InterviewPlanTopic,
  InterviewQuestionKind,
  InterviewReview,
  InterviewTurn,
} from '@jobradar/shared';

export const RESUME_TEXT_LIMIT = 5000;
export const ANSWER_TEXT_LIMIT = 12000;
export const TURN_TEXT_LIMIT = 1500;

export function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

/** ASCII slug for a stable topic key; falls back to a positional key. */
export function slugify(text: string, fallbackIndex: number): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || `topic-${fallbackIndex + 1}`;
}

const KIND_LABEL: Record<InterviewQuestionKind, string> = {
  theory: 'theory / knowledge',
  behavioral: 'behavioural',
  coding: 'live-coding',
};

// ---------------------------------------------------------------------------
// Prep plan
// ---------------------------------------------------------------------------

export interface PlanTarget {
  targetRole?: string;
  targetSeniority?: string;
  focus?: string[];
}

export function buildPlanPrompt(
  resumeText: string,
  target: PlanTarget,
): { system: string; user: string } {
  const system = [
    'You are an interview-prep coach. From a candidate resume you build a focused study plan.',
    'Reply with ONE JSON object and nothing else, shaped exactly as:',
    '{"sections":[{"title":"...","topics":[{"title":"...","why":"..."}]}]}',
    'Rules:',
    '- 4–7 sections, each with 2–5 topics; order from foundational to advanced.',
    '- Ground the plan in the resume: emphasise the stack and level actually shown; cover likely gaps for the target role.',
    '- "why" is one short sentence on why the topic matters for this candidate.',
    '- Write titles and why in the same language as the resume.',
    '- No prose, no markdown, no comments — JSON only.',
  ].join('\n');

  const targetLine = [
    target.targetRole ? `Target role: ${target.targetRole}` : null,
    target.targetSeniority ? `Target seniority: ${target.targetSeniority}` : null,
    target.focus?.length ? `Focus areas: ${target.focus.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const user = [
    targetLine || 'Target role: infer from the resume.',
    `\nCandidate resume:\n${truncate(resumeText, RESUME_TEXT_LIMIT)}`,
    '\nBuild the plan now.',
  ].join('\n');

  return { system, user };
}

/** Parses the plan reply, assigning stable unique topic keys. Null on garbage. */
export function parsePlanReply(text: string): InterviewPlanStructure | null {
  const json = extractJsonObject(text);
  if (!json) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  const rawSections = (parsed as { sections?: unknown }).sections;
  if (!Array.isArray(rawSections)) return null;

  const usedKeys = new Set<string>();
  const sections = rawSections
    .map((rawSection) => {
      const s = rawSection as { title?: unknown; topics?: unknown };
      const title = typeof s.title === 'string' ? s.title.trim() : '';
      const rawTopics = Array.isArray(s.topics) ? s.topics : [];
      const topics: InterviewPlanTopic[] = rawTopics
        .map((rawTopic, i): InterviewPlanTopic | null => {
          const t = rawTopic as { title?: unknown; why?: unknown };
          const topicTitle = typeof t.title === 'string' ? t.title.trim() : '';
          if (!topicTitle) return null;
          const why = typeof t.why === 'string' ? t.why.trim() : '';
          let key = slugify(topicTitle, i);
          while (usedKeys.has(key)) key = `${key}-${i}`;
          usedKeys.add(key);
          return { key, title: topicTitle, why };
        })
        .filter((t): t is InterviewPlanTopic => t !== null);
      return title && topics.length ? { title, topics } : null;
    })
    .filter((s): s is { title: string; topics: InterviewPlanTopic[] } => s !== null);

  return sections.length ? { sections } : null;
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export interface QuestionsRequest {
  topic: string;
  kind: InterviewQuestionKind;
  difficulty?: string;
  count: number;
  resumeText?: string | null;
}

export function buildQuestionsPrompt(req: QuestionsRequest): { system: string; user: string } {
  const isCoding = req.kind === 'coding';
  const system = [
    `You generate ${KIND_LABEL[req.kind]} interview questions for one topic.`,
    'Reply with ONE JSON array of strings and nothing else, e.g. ["...","..."].',
    isCoding
      ? '- Each string is a self-contained live-coding task statement (inputs, expected output, constraints). No solution.'
      : '- Each string is a single clear question. No answers, no numbering.',
    '- Match the requested difficulty; make them realistic for a real interview.',
    '- Write in the same language as the topic/resume.',
    '- JSON array only, no prose or markdown.',
  ].join('\n');

  const user = [
    `Topic: ${req.topic}`,
    `Kind: ${req.kind}`,
    req.difficulty ? `Difficulty: ${req.difficulty}` : null,
    `How many: ${req.count}`,
    req.resumeText
      ? `\nCandidate resume (for calibration only):\n${truncate(req.resumeText, RESUME_TEXT_LIMIT)}`
      : null,
    '\nGenerate the questions now.',
  ]
    .filter(Boolean)
    .join('\n');

  return { system, user };
}

/** Parses a JSON array of question strings. Empty array on garbage. */
export function parseQuestionsReply(text: string): string[] {
  const json = extractJsonArray(text);
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((q) => (typeof q === 'string' ? q.trim() : ''))
      .filter((q) => q.length > 0);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Model answer
// ---------------------------------------------------------------------------

export function buildModelAnswerPrompt(
  kind: InterviewQuestionKind,
  prompt: string,
): { system: string; user: string } {
  const system =
    kind === 'coding'
      ? [
          'You are a senior engineer. Give a reference solution to a live-coding task.',
          'Explain the approach briefly, then provide clean, correct code, then note time/space complexity.',
          'Answer in the language the task is written in. Plain text / markdown code fences only.',
        ].join('\n')
      : [
          'You are a senior interviewer giving a model answer to an interview question.',
          'Be accurate and concise: the key points a strong candidate would cover, no filler.',
          'Answer in the language the question is written in.',
        ].join('\n');

  return { system, user: `Question:\n${prompt}\n\nWrite the model answer now.` };
}

// ---------------------------------------------------------------------------
// Answer review (live-coding and written answers)
// ---------------------------------------------------------------------------

export function buildReviewPrompt(
  kind: InterviewQuestionKind,
  prompt: string,
  answer: string,
): { system: string; user: string } {
  const system = [
    `You review a candidate's ${KIND_LABEL[kind]} answer. You do NOT run code — reason about it.`,
    'Reply with ONE JSON object and nothing else:',
    '{"score":<integer 0-100>,"verdict":"...","correctness":"...","complexity":"...","style":"...","suggestions":["...","..."]}',
    '- score: 0 = wrong/empty, 100 = fully correct and idiomatic.',
    '- correctness: does it solve the task, edge cases handled? complexity: time/space if relevant.',
    '- style: readability, naming, structure. suggestions: 1–4 concrete improvements.',
    '- Be honest and specific; never invent facts. Write in the language of the answer.',
    '- JSON only, no prose or markdown.',
  ].join('\n');

  const user = [
    `Question/task:\n${prompt}`,
    `\nCandidate answer:\n${truncate(answer, ANSWER_TEXT_LIMIT)}`,
    '\nReview it now.',
  ].join('\n');

  return { system, user };
}

/** Parses the review reply; score is normalised to [0, 1]. Null on garbage. */
export function parseReviewReply(text: string): { score: number; review: InterviewReview } | null {
  const json = extractJsonObject(text);
  if (!json) return null;
  try {
    const p = JSON.parse(json) as Record<string, unknown>;
    const rawScore = typeof p.score === 'number' ? p.score : Number(p.score);
    if (!Number.isFinite(rawScore)) return null;
    const score = Math.min(100, Math.max(0, rawScore)) / 100;
    const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
    const suggestions = Array.isArray(p.suggestions)
      ? p.suggestions.map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean)
      : [];
    const review: InterviewReview = {
      verdict: str(p.verdict),
      correctness: str(p.correctness),
      complexity: str(p.complexity),
      style: str(p.style),
      suggestions,
    };
    if (!review.verdict && !review.correctness) return null;
    return { score, review };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Mock interview (text chat)
// ---------------------------------------------------------------------------

export interface SessionTarget {
  targetRole?: string | null;
  targetSeniority?: string | null;
}

/** Serialises the transcript so far into a plain-text conversation log. */
function renderTranscript(transcript: InterviewTurn[]): string {
  if (transcript.length === 0) return 'The interview is just starting.';
  return transcript
    .map((t) => `${t.role === 'interviewer' ? 'Interviewer' : 'Candidate'}: ${truncate(t.content, TURN_TEXT_LIMIT)}`)
    .join('\n\n');
}

/** Interviewer's next message given the transcript so far. */
export function buildInterviewerPrompt(
  target: SessionTarget,
  resumeText: string,
  transcript: InterviewTurn[],
): { system: string; user: string } {
  const role = target.targetRole || 'the role the resume fits';
  const system = [
    `You are a technical interviewer running a realistic mock interview for ${role}${
      target.targetSeniority ? ` (${target.targetSeniority} level)` : ''
    }.`,
    'Rules:',
    '- Ask ONE question at a time. First briefly acknowledge or probe the previous answer, then ask the next question.',
    '- Base questions on the resume and the role; go progressively deeper. Mix theory, experience, and problem-solving.',
    '- Stay in character: no scores, no feedback, no meta commentary — that comes only at the very end.',
    '- Write in the language of the resume. Output ONLY your next message, with no "Interviewer:" prefix.',
    '- Keep each message short (1–4 sentences).',
  ].join('\n');

  const user = [
    `Candidate resume:\n${truncate(resumeText, RESUME_TEXT_LIMIT)}`,
    `\nConversation so far:\n${renderTranscript(transcript)}`,
    transcript.length === 0
      ? '\nGreet the candidate in one line and ask your first question.'
      : '\nGive your next interviewer message.',
  ].join('\n');

  return { system, user };
}

/** Strips a stray leading role label the model may add despite instructions. */
export function cleanInterviewerReply(text: string): string {
  return text.trim().replace(/^(Interviewer|Interviewer's message)\s*:\s*/i, '');
}

/** Final feedback report over the whole transcript. */
export function buildFeedbackPrompt(
  target: SessionTarget,
  transcript: InterviewTurn[],
): { system: string; user: string } {
  const role = target.targetRole || 'the target role';
  const system = [
    `You are the interviewer, now writing honest post-interview feedback for a mock interview for ${role}.`,
    'Reply with ONE JSON object and nothing else:',
    '{"score":<integer 0-100>,"summary":"...","strengths":["..."],"gaps":["..."],"recommendation":"..."}',
    '- score: overall performance for the target level.',
    '- summary: 1–2 sentences. strengths/gaps: 1–4 concrete items each, grounded in what was actually said.',
    '- recommendation: one line on what to work on before the real interview.',
    '- Be specific and honest; never invent answers the candidate did not give. Write in the language of the transcript.',
    '- JSON only, no prose or markdown.',
  ].join('\n');

  const user = [
    `Interview transcript:\n${renderTranscript(transcript)}`,
    '\nWrite the feedback now.',
  ].join('\n');

  return { system, user };
}

/** Parses the feedback reply; score is normalised to [0, 1]. Null on garbage. */
export function parseFeedbackReply(text: string): InterviewFeedback | null {
  const json = extractJsonObject(text);
  if (!json) return null;
  try {
    const p = JSON.parse(json) as Record<string, unknown>;
    const rawScore = typeof p.score === 'number' ? p.score : Number(p.score);
    if (!Number.isFinite(rawScore)) return null;
    const score = Math.min(100, Math.max(0, rawScore)) / 100;
    const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
    const list = (v: unknown): string[] =>
      Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean) : [];
    const summary = str(p.summary);
    const recommendation = str(p.recommendation);
    if (!summary && !recommendation) return null;
    return {
      summary,
      strengths: list(p.strengths),
      gaps: list(p.gaps),
      recommendation,
      score,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// JSON extraction helpers — models often wrap JSON in prose or code fences.
// ---------------------------------------------------------------------------

function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : null;
}

function extractJsonArray(text: string): string | null {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  return start >= 0 && end > start ? text.slice(start, end + 1) : null;
}

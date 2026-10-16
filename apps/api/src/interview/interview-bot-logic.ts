import { HttpException } from '@nestjs/common';
import {
  BOT_CALLBACK_NAMESPACES,
  type InterviewAnswerReview,
  type InterviewFeedback,
  type InterviewPlanDetail,
  type InterviewQuestionItem,
  type InterviewTopicStatus,
  type Language,
} from '@jobradar/shared';

import { escapeHtml, type InlineButton, type InlineKeyboard } from '../bot/telegram-api';
import { takeChunk } from '../digest/render';

/**
 * `/interview` in the bot (roadmap 5.5, owner only per ADR-024 §3), kept pure:
 * how the menu, the topic plan, a question, a review and the mock interview
 * look, and what a button press asks for. The service only calls
 * `InterviewService`, opens dialogs and sends.
 *
 * Topics are addressed by their position in the active plan (sections
 * flattened in order), which keeps callback data short. Callback data is
 * `i:<action>[:...]`, at most 2 + 2 + 4 + 4 + 36 = 48 bytes, inside Telegram's 64:
 *   i:h                  the menu
 *   i:g                  build a topic plan from the resume (LLM)
 *   i:p:<page>           the topic plan, a page of topics
 *   i:t:<topic>          a topic: its status buttons
 *   i:s:<topic>:<code>   set a topic's status (codes in STATUS_CODES)
 *   i:qp:<page>          pick a topic for questions
 *   i:q:<topic>:<n>      question n of a topic (generated when missing, LLM)
 *   i:m:<question uuid>  the model answer (LLM, cached)
 *   i:a:<topic>:<n>:<question uuid>  answer the question: opens a typed dialog
 *   i:k                  start or resume the mock interview
 *   i:f:<session uuid>   finish the mock interview (LLM feedback)
 *   i:z:<session uuid>   pause it: the dialog closes, the session stays active
 */

const NS = BOT_CALLBACK_NAMESPACES.interview;

/** Telegram refuses longer messages. */
export const MESSAGE_LIMIT = 4096;

/** Topics per screen of the plan and of the topic picker. */
export const TOPICS_PER_PAGE = 8;

/** How many questions one generation asks the LLM for. */
export const QUESTIONS_PER_BATCH = 3;

/** The dialog flow of typed answers (question answers and mock interview replies). */
export const DIALOG_FLOW = 'interview';
export const DIALOG_STEPS = { answer: 'answer', mock: 'mock' } as const;

export const STATUS_CODES = {
  todo: 'o',
  in_progress: 'w',
  done: 'd',
} as const satisfies Record<InterviewTopicStatus, string>;

const STATUSES = Object.keys(STATUS_CODES) as InterviewTopicStatus[];

const STATUS_ICON: Record<InterviewTopicStatus, string> = {
  todo: '⚪',
  in_progress: '🟡',
  done: '✅',
};

const TEXT = {
  en: {
    ownerOnly: 'Interview prep is available to the JobRadar author only.',
    title: '🎓 Interview prep',
    noPlan:
      'No topic plan yet. Build one from your resume: the topics an interviewer is likely to ask about, grouped by section.',
    progress: 'Topic plan: {done} done, {inProgress} in progress, {todo} to do.',
    activeSession: '⏸ A mock interview is paused: you can resume it.',
    pick: 'What do you want to practise?',
    mock: '🎤 Mock interview',
    resume: '▶️ Resume interview',
    questions: '📚 Questions by topic',
    plan: '🗺 Topic plan',
    buildPlan: '🗺 Build a topic plan',
    menu: '🏠 Menu',
    back: '⬅️ Back',
    prev: '⬅️ Previous',
    next: 'Next ➡️',
    planTitle: '🗺 Topic plan',
    page: 'Page {page} of {pages}.',
    tapTopic: 'Tap a topic to change its status.',
    pickTopic: '📚 Questions by topic\n\nPick a topic: I will ask you questions on it.',
    needPlan: 'Build a topic plan first.',
    topicGone: 'This topic is no longer in your plan.',
    status: 'Status',
    'status.todo': '⚪ To do',
    'status.in_progress': '🟡 In progress',
    'status.done': '✅ Done',
    statusSet: 'Status: {status}',
    current: '{label} (now)',
    question: 'Question {n}',
    modelAnswer: '💡 Model answer',
    answerIt: '✍️ Answer it',
    nextQuestion: '➡️ Next question',
    modelAnswerTitle: '💡 Model answer',
    answerPrompt: '✍️ Type your answer to the question above in one message: I will review it.',
    reviewTitle: '📝 Review: {score}/10',
    correctness: '✔️ Correctness',
    complexity: '⏱ Complexity',
    style: '🎨 Style',
    suggestions: '💡 Suggestions',
    finish: '🏁 Finish',
    pause: '⏸ Pause',
    paused: '⏸ Paused. The interview stays open: resume it from /interview.',
    interviewer: '🎤 Interviewer',
    replyHint: 'Reply with a message. 🏁 Finish ends the interview and gives feedback.',
    feedbackTitle: '🏁 Interview finished: {score}/10',
    strengths: '💪 Strengths',
    gaps: '📉 Gaps',
    recommendation: '🧭 Recommendation',
    thinking: '⏳ Thinking…',
    working: '⏳ On it…',
    noResume: 'Upload your resume first (send the PDF here): this is built from it.',
    answerFirst: 'Answer at least one question before finishing the interview.',
    ended: 'This interview has already ended. Start a new one from /interview.',
    failed: 'The AI did not answer this time. Try again in a minute.',
    planBuilt: '🗺 Your topic plan is ready.',
  },
  ru: {
    ownerOnly: 'Подготовка к собеседованиям доступна только автору JobRadar.',
    title: '🎓 Подготовка к собеседованию',
    noPlan:
      'Плана тем пока нет. Собери его по резюме: темы, о которых, скорее всего, спросят на собеседовании, по разделам.',
    progress: 'План тем: готово {done}, в процессе {inProgress}, не начато {todo}.',
    activeSession: '⏸ Пробное собеседование на паузе: его можно продолжить.',
    pick: 'Что потренируем?',
    mock: '🎤 Пробное собеседование',
    resume: '▶️ Продолжить собеседование',
    questions: '📚 Вопросы по темам',
    plan: '🗺 План тем',
    buildPlan: '🗺 Собрать план тем',
    menu: '🏠 Меню',
    back: '⬅️ Назад',
    prev: '⬅️ Назад',
    next: 'Дальше ➡️',
    planTitle: '🗺 План тем',
    page: 'Страница {page} из {pages}.',
    tapTopic: 'Нажми на тему, чтобы поменять её статус.',
    pickTopic: '📚 Вопросы по темам\n\nВыбери тему: я буду задавать по ней вопросы.',
    needPlan: 'Сначала собери план тем.',
    topicGone: 'Этой темы больше нет в плане.',
    status: 'Статус',
    'status.todo': '⚪ Не начато',
    'status.in_progress': '🟡 В процессе',
    'status.done': '✅ Готово',
    statusSet: 'Статус: {status}',
    current: '{label} (сейчас)',
    question: 'Вопрос {n}',
    modelAnswer: '💡 Эталонный ответ',
    answerIt: '✍️ Ответить',
    nextQuestion: '➡️ Следующий вопрос',
    modelAnswerTitle: '💡 Эталонный ответ',
    answerPrompt: '✍️ Напиши ответ на вопрос выше одним сообщением: я его разберу.',
    reviewTitle: '📝 Разбор: {score}/10',
    correctness: '✔️ Правильность',
    complexity: '⏱ Сложность',
    style: '🎨 Стиль',
    suggestions: '💡 Что улучшить',
    finish: '🏁 Завершить',
    pause: '⏸ Пауза',
    paused: '⏸ Пауза. Собеседование не закрыто: продолжить можно из /interview.',
    interviewer: '🎤 Интервьюер',
    replyHint: 'Отвечай сообщением. 🏁 Завершить — закончить и получить разбор.',
    feedbackTitle: '🏁 Собеседование завершено: {score}/10',
    strengths: '💪 Сильные стороны',
    gaps: '📉 Пробелы',
    recommendation: '🧭 Рекомендация',
    thinking: '⏳ Думаю…',
    working: '⏳ Делаю…',
    noResume: 'Сначала загрузи резюме (пришли PDF сюда): всё строится по нему.',
    answerFirst: 'Ответь хотя бы на один вопрос, прежде чем завершать собеседование.',
    ended: 'Это собеседование уже завершено. Начни новое из /interview.',
    failed: 'AI сейчас не ответил. Попробуй ещё раз через минуту.',
    planBuilt: '🗺 План тем готов.',
  },
} as const;

export type InterviewTextKey = keyof (typeof TEXT)['en'];

export function interviewText(
  lang: Language,
  key: InterviewTextKey,
  vars: Record<string, string | number> = {},
): string {
  const template: string = TEXT[lang]?.[key] ?? TEXT.en[key];
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

export interface Screen {
  text: string;
  keyboard: InlineKeyboard;
}

// ---------------------------------------------------------------------------
// Plan data
// ---------------------------------------------------------------------------

export interface FlatTopic {
  key: string;
  title: string;
  why: string;
  section: string;
  status: InterviewTopicStatus;
}

/** The plan's topics in reading order, each with its current status. */
export function flattenTopics(plan: InterviewPlanDetail): FlatTopic[] {
  const status = new Map(plan.progress.map((p) => [p.topicKey, p.status]));
  return plan.structure.sections.flatMap((section) =>
    section.topics.map((topic) => ({
      key: topic.key,
      title: topic.title,
      why: topic.why,
      section: section.title,
      status: status.get(topic.key) ?? 'todo',
    })),
  );
}

export function progressCounts(plan: InterviewPlanDetail): Record<InterviewTopicStatus, number> {
  const counts: Record<InterviewTopicStatus, number> = { todo: 0, in_progress: 0, done: 0 };
  for (const topic of flattenTopics(plan)) counts[topic.status] += 1;
  return counts;
}

export function statusLabel(lang: Language, status: InterviewTopicStatus): string {
  return interviewText(lang, `status.${status}`);
}

function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / TOPICS_PER_PAGE));
}

function clampPage(page: number, total: number): number {
  return Math.min(Math.max(0, page), pageCount(total) - 1);
}

export function pageOf(index: number): number {
  return Math.floor(index / TOPICS_PER_PAGE);
}

/**
 * Questions of a topic, oldest first. A batch is inserted in one statement and
 * shares a timestamp, so the id breaks ties: "question n" must mean the same
 * question on every press.
 */
export function orderQuestions(items: InterviewQuestionItem[]): InterviewQuestionItem[] {
  return [...items].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

function rows(buttons: InlineButton[]): InlineKeyboard {
  const out: InlineKeyboard = [];
  for (let i = 0; i < buttons.length; i += 2) out.push(buttons.slice(i, i + 2));
  return out;
}

function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export function renderMenu(
  lang: Language,
  plan: InterviewPlanDetail | null,
  hasActiveSession: boolean,
): Screen {
  const lines = [`<b>${escapeHtml(interviewText(lang, 'title'))}</b>`, ''];
  if (plan) {
    const counts = progressCounts(plan);
    lines.push(
      escapeHtml(
        interviewText(lang, 'progress', {
          done: counts.done,
          inProgress: counts.in_progress,
          todo: counts.todo,
        }),
      ),
    );
  } else {
    lines.push(escapeHtml(interviewText(lang, 'noPlan')));
  }
  if (hasActiveSession) lines.push('', escapeHtml(interviewText(lang, 'activeSession')));
  lines.push('', escapeHtml(interviewText(lang, 'pick')));

  const buttons: InlineButton[] = [
    {
      text: interviewText(lang, hasActiveSession ? 'resume' : 'mock'),
      callbackData: `${NS}:k`,
    },
  ];
  if (plan) {
    buttons.push(
      { text: interviewText(lang, 'questions'), callbackData: `${NS}:qp:0` },
      { text: interviewText(lang, 'plan'), callbackData: `${NS}:p:0` },
    );
  } else {
    buttons.push({ text: interviewText(lang, 'buildPlan'), callbackData: `${NS}:g` });
  }
  return { text: lines.join('\n'), keyboard: rows(buttons) };
}

/** A page of topics as buttons, with paging and a way back to the menu. */
function topicPage(
  lang: Language,
  topics: FlatTopic[],
  page: number,
  pageAction: string,
  topicCallback: (index: number) => string,
): { keyboard: InlineKeyboard; page: number } {
  const current = clampPage(page, topics.length);
  const start = current * TOPICS_PER_PAGE;
  const buttons = topics.slice(start, start + TOPICS_PER_PAGE).map((topic, offset) => ({
    text: `${STATUS_ICON[topic.status]} ${cut(topic.title, 28)}`,
    callbackData: topicCallback(start + offset),
  }));
  const keyboard = rows(buttons);

  const nav: InlineButton[] = [];
  if (current > 0) {
    nav.push({
      text: interviewText(lang, 'prev'),
      callbackData: `${NS}:${pageAction}:${current - 1}`,
    });
  }
  if (current < pageCount(topics.length) - 1) {
    nav.push({
      text: interviewText(lang, 'next'),
      callbackData: `${NS}:${pageAction}:${current + 1}`,
    });
  }
  if (nav.length > 0) keyboard.push(nav);
  keyboard.push([{ text: interviewText(lang, 'menu'), callbackData: `${NS}:h` }]);
  return { keyboard, page: current };
}

export function renderPlan(lang: Language, plan: InterviewPlanDetail, page: number): Screen {
  const topics = flattenTopics(plan);
  const counts = progressCounts(plan);
  const { keyboard, page: current } = topicPage(lang, topics, page, 'p', (i) => `${NS}:t:${i}`);

  const lines = [
    `<b>${escapeHtml(interviewText(lang, 'planTitle'))}</b>`,
    escapeHtml(
      interviewText(lang, 'progress', {
        done: counts.done,
        inProgress: counts.in_progress,
        todo: counts.todo,
      }),
    ),
    '',
  ];
  const start = current * TOPICS_PER_PAGE;
  let section = '';
  topics.slice(start, start + TOPICS_PER_PAGE).forEach((topic, offset) => {
    if (topic.section !== section) {
      section = topic.section;
      lines.push(`<b>${escapeHtml(section)}</b>`);
    }
    lines.push(`${STATUS_ICON[topic.status]} ${start + offset + 1}. ${escapeHtml(topic.title)}`);
  });
  lines.push('');
  if (pageCount(topics.length) > 1) {
    lines.push(
      escapeHtml(
        interviewText(lang, 'page', { page: current + 1, pages: pageCount(topics.length) }),
      ),
    );
  }
  lines.push(escapeHtml(interviewText(lang, 'tapTopic')));
  return { text: lines.join('\n'), keyboard };
}

/** A topic with its three status buttons; null when the index is out of the plan. */
export function renderTopic(
  lang: Language,
  plan: InterviewPlanDetail,
  index: number,
): Screen | null {
  const topic = flattenTopics(plan)[index];
  if (!topic) return null;
  const lines = [
    `<b>${escapeHtml(`${index + 1}. ${topic.title}`)}</b>`,
    `<i>${escapeHtml(topic.section)}</i>`,
  ];
  if (topic.why) lines.push('', escapeHtml(topic.why));
  lines.push(
    '',
    `${escapeHtml(interviewText(lang, 'status'))}: ${escapeHtml(statusLabel(lang, topic.status))}`,
  );

  const buttons = STATUSES.map((status) => {
    const label = statusLabel(lang, status);
    return {
      text: status === topic.status ? interviewText(lang, 'current', { label }) : label,
      callbackData: `${NS}:s:${index}:${STATUS_CODES[status]}`,
    };
  });
  const keyboard = rows(buttons);
  keyboard.push([
    { text: interviewText(lang, 'back'), callbackData: `${NS}:p:${pageOf(index)}` },
    { text: interviewText(lang, 'menu'), callbackData: `${NS}:h` },
  ]);
  return { text: lines.join('\n'), keyboard };
}

export function renderTopicPicker(lang: Language, plan: InterviewPlanDetail, page: number): Screen {
  const topics = flattenTopics(plan);
  const { keyboard, page: current } = topicPage(lang, topics, page, 'qp', (i) => `${NS}:q:${i}:0`);
  const lines = [escapeHtml(interviewText(lang, 'pickTopic'))];
  if (pageCount(topics.length) > 1) {
    lines.push(
      '',
      escapeHtml(
        interviewText(lang, 'page', { page: current + 1, pages: pageCount(topics.length) }),
      ),
    );
  }
  return { text: lines.join('\n'), keyboard };
}

/** The keyboard under a question and under its review. */
function questionKeyboard(
  lang: Language,
  index: number,
  n: number,
  question: InterviewQuestionItem | null,
): InlineKeyboard {
  const buttons: InlineButton[] = [];
  if (question) {
    buttons.push(
      { text: interviewText(lang, 'modelAnswer'), callbackData: `${NS}:m:${question.id}` },
      {
        text: interviewText(lang, 'answerIt'),
        callbackData: `${NS}:a:${index}:${n}:${question.id}`,
      },
    );
  }
  buttons.push(
    { text: interviewText(lang, 'nextQuestion'), callbackData: `${NS}:q:${index}:${n + 1}` },
    { text: interviewText(lang, 'back'), callbackData: `${NS}:qp:${pageOf(index)}` },
  );
  return rows(buttons);
}

/** One question of a topic, with its buttons. The text is cut to fit one message. */
export function renderQuestion(
  lang: Language,
  topicTitle: string,
  index: number,
  n: number,
  question: InterviewQuestionItem,
): Screen {
  const head =
    `<b>📚 ${escapeHtml(topicTitle)}</b>\n` +
    `<i>${escapeHtml(interviewText(lang, 'question', { n: n + 1 }))}</i>\n\n`;
  const [body, rest] = takeChunk(question.prompt.trim(), MESSAGE_LIMIT - head.length - 2);
  return {
    text: `${head}${escapeHtml(body)}${rest ? '…' : ''}`,
    keyboard: questionKeyboard(lang, index, n, question),
  };
}

export function renderAnswerPrompt(lang: Language): string {
  return escapeHtml(interviewText(lang, 'answerPrompt'));
}

/** Buttons under a review: the next question of the same topic, or back to the topics. */
export function reviewKeyboard(lang: Language, index: number, n: number): InlineKeyboard {
  return questionKeyboard(lang, index, n, null);
}

export function mockKeyboard(lang: Language, sessionId: string): InlineKeyboard {
  return [
    [
      { text: interviewText(lang, 'finish'), callbackData: `${NS}:f:${sessionId}` },
      { text: interviewText(lang, 'pause'), callbackData: `${NS}:z:${sessionId}` },
    ],
  ];
}

export function pausedKeyboard(lang: Language): InlineKeyboard {
  return [
    [
      { text: interviewText(lang, 'resume'), callbackData: `${NS}:k` },
      { text: interviewText(lang, 'menu'), callbackData: `${NS}:h` },
    ],
  ];
}

export function menuKeyboard(lang: Language): InlineKeyboard {
  return [[{ text: interviewText(lang, 'menu'), callbackData: `${NS}:h` }]];
}

// ---------------------------------------------------------------------------
// Long LLM output
// ---------------------------------------------------------------------------

/**
 * Splits `body` (plain text) into Telegram messages: the first one starts with
 * `headHtml`, every part is HTML-escaped and at most `MESSAGE_LIMIT` long.
 */
export function splitMessage(headHtml: string, body: string, limit = MESSAGE_LIMIT): string[] {
  const parts: string[] = [];
  let rest = body.trim();
  let prefix = headHtml;
  while (rest) {
    const [chunk, remainder] = takeChunk(rest, limit - prefix.length);
    // A budget too small for even one word: stop rather than loop forever.
    if (!chunk) break;
    parts.push(`${prefix}${escapeHtml(chunk)}`);
    rest = remainder;
    prefix = '';
  }
  return parts.length > 0 ? parts : [headHtml.trimEnd()];
}

function score10(score: number): string {
  const value = Math.round(Math.min(1, Math.max(0, score)) * 100) / 10;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function bullets(items: string[]): string {
  return items.map((item) => `• ${item}`).join('\n');
}

export function renderModelAnswer(lang: Language, answer: string): string[] {
  return splitMessage(`<b>${escapeHtml(interviewText(lang, 'modelAnswerTitle'))}</b>\n\n`, answer);
}

export function renderInterviewer(lang: Language, content: string): string[] {
  const parts = splitMessage(
    `<b>${escapeHtml(interviewText(lang, 'interviewer'))}</b>\n\n`,
    content,
  );
  const hint = `\n\n<i>${escapeHtml(interviewText(lang, 'replyHint'))}</i>`;
  const last = parts.length - 1;
  const tail = parts[last] ?? '';
  if (tail.length + hint.length <= MESSAGE_LIMIT) parts[last] = `${tail}${hint}`;
  return parts;
}

export function renderReview(lang: Language, result: InterviewAnswerReview): string[] {
  const { review } = result;
  const sections = [
    review.verdict,
    `${interviewText(lang, 'correctness')}\n${review.correctness}`,
    `${interviewText(lang, 'complexity')}\n${review.complexity}`,
    `${interviewText(lang, 'style')}\n${review.style}`,
  ];
  if (review.suggestions.length > 0) {
    sections.push(`${interviewText(lang, 'suggestions')}\n${bullets(review.suggestions)}`);
  }
  const head = `<b>${escapeHtml(interviewText(lang, 'reviewTitle', { score: score10(result.score) }))}</b>\n\n`;
  return splitMessage(head, sections.filter((s) => s.trim()).join('\n\n'));
}

export function renderFeedback(lang: Language, feedback: InterviewFeedback): string[] {
  const sections = [feedback.summary];
  if (feedback.strengths.length > 0) {
    sections.push(`${interviewText(lang, 'strengths')}\n${bullets(feedback.strengths)}`);
  }
  if (feedback.gaps.length > 0) {
    sections.push(`${interviewText(lang, 'gaps')}\n${bullets(feedback.gaps)}`);
  }
  if (feedback.recommendation) {
    sections.push(`${interviewText(lang, 'recommendation')}\n${feedback.recommendation}`);
  }
  const head = `<b>${escapeHtml(
    interviewText(lang, 'feedbackTitle', { score: score10(feedback.score) }),
  )}</b>\n\n`;
  return splitMessage(head, sections.filter((s) => s.trim()).join('\n\n'));
}

/**
 * The friendly message for a failed call. `InterviewService` raises 400s with
 * English reasons meant for the web; the bot maps the ones a user can act on
 * and treats everything else (LLM down, unparsable reply) as "try again".
 */
export function errorKey(err: unknown): InterviewTextKey {
  if (err instanceof HttpException && err.getStatus() === 400) {
    const message = err.message.toLowerCase();
    if (message.includes('resume')) return 'noResume';
    if (message.includes('at least one question')) return 'answerFirst';
    if (message.includes('already ended')) return 'ended';
  }
  return 'failed';
}

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

export type InterviewAction =
  | { kind: 'menu' }
  | { kind: 'buildPlan' }
  | { kind: 'plan'; page: number }
  | { kind: 'topic'; index: number }
  | { kind: 'status'; index: number; status: InterviewTopicStatus }
  | { kind: 'pickTopic'; page: number }
  | { kind: 'question'; index: number; n: number }
  | { kind: 'modelAnswer'; questionId: string }
  | { kind: 'answer'; index: number; n: number; questionId: string }
  | { kind: 'mock' }
  | { kind: 'finish'; sessionId: string }
  | { kind: 'pause'; sessionId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function int(value: string | undefined): number | null {
  if (value === undefined || !/^\d{1,4}$/.test(value)) return null;
  return Number(value);
}

/** What a press asks for; null for malformed or foreign data. */
export function parseCallback(parts: string[]): InterviewAction | null {
  const [ns, action, a, b, c] = parts;
  if (ns !== NS) return null;
  switch (action) {
    case 'h':
      return { kind: 'menu' };
    case 'g':
      return { kind: 'buildPlan' };
    case 'k':
      return { kind: 'mock' };
    case 'p':
    case 'qp': {
      const page = int(a);
      if (page === null) return null;
      return action === 'p' ? { kind: 'plan', page } : { kind: 'pickTopic', page };
    }
    case 't': {
      const index = int(a);
      return index === null ? null : { kind: 'topic', index };
    }
    case 's': {
      const index = int(a);
      const status = STATUSES.find((s) => STATUS_CODES[s] === b);
      return index === null || !status ? null : { kind: 'status', index, status };
    }
    case 'q': {
      const index = int(a);
      const n = int(b);
      return index === null || n === null ? null : { kind: 'question', index, n };
    }
    case 'a': {
      const index = int(a);
      const n = int(b);
      if (index === null || n === null || !c || !UUID.test(c)) return null;
      return { kind: 'answer', index, n, questionId: c };
    }
    case 'm':
      return a && UUID.test(a) ? { kind: 'modelAnswer', questionId: a } : null;
    case 'f':
    case 'z':
      if (!a || !UUID.test(a)) return null;
      return action === 'f' ? { kind: 'finish', sessionId: a } : { kind: 'pause', sessionId: a };
    default:
      return null;
  }
}

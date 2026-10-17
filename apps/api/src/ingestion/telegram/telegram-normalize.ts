import type { NewVacancy } from "../hh/hh-normalize";
import { normalizeCompanyName } from "../company-name";

/**
 * Regex-first parsing of Telegram job-channel posts (ADR-009). Channels are
 * free-form, so every field except title is best-effort: missing fields stay
 * null and matching rules must tolerate sparse data (docs/DATA_SOURCES.md).
 */

export interface TelegramMessageInput {
  channel: string;
  messageId: number;
  text: string;
  date: Date | null;
}

/** Posts shorter than this are service notes/ads, not vacancies. */
const MIN_VACANCY_LENGTH = 80;

/**
 * Non-vacancy noise that leaks into job channels: moderation-bot notices,
 * giveaways, and ads. Genuine posts are free-form (ADR-009), so the deny-lists
 * stay narrow; `hasVacancySignals` is the positive check.
 */
const JUNK_PATTERNS: RegExp[] = [
  // Anti-spam bot notices (e.g. "тебя заблокировали (Lols Ban)").
  /lols\s*ban/iu,
  /тебя\s+заблокировали/iu,
  /глобальн\p{L}*\s+блокировк/iu,
  /отмечен\p{L}*\s+к\s+глобальной\s+блокировке/iu,
  // Giveaways / repost contests / ads — not jobs. Cyrillic word boundaries use
  // Unicode lookarounds; JS `\b` only sees ASCII word chars, even with /u.
  /розыгрыш|giveaway/iu,
  /конкурс\s+репостов/iu,
  /(?<![\p{L}\p{N}])реклам[аеуы](?![\p{L}\p{N}])/iu,
];

/** True for moderation notices, giveaways, ads — anything that isn't a job. */
export function isJunkPost(text: string): boolean {
  return JUNK_PATTERNS.some((re) => re.test(text));
}

/**
 * Job seekers' posts. The group chats among the channels (golang_jobs,
 * qa_jobs, python_jobs, …) carry "vacancies and job-search requests", so a
 * resume tagged or phrased as one must not become a vacancy. Only explicit
 * markers: "ищу разработчика" is a vacancy, "ищу работу" is not.
 */
const RESUME_PATTERNS: RegExp[] = [
  /#(?:резюме|cv|resume|ищу_?работу|opentowork|lookingforjob)(?![\p{L}\p{N}_])/iu,
  /(?<![\p{L}\p{N}])(?:ищу\s+(?:работу|проект|подработку)|в\s+поиске\s+работы|open\s+to\s+work)(?![\p{L}\p{N}])/iu,
  /\blooking\s+for\s+(?:a\s+)?(?:job|new\s+(?:job|opportunit))/iu,
];

/** True for a job seeker's post (resume, "ищу работу"), not a vacancy. */
export function isResumePost(text: string): boolean {
  return RESUME_PATTERNS.some((re) => re.test(text));
}

/**
 * Career-service and course promotion ("Сейчас найти работу - целый квест…",
 * "поможем получить оффер", "автоотклики"). Such posts talk about job search,
 * so they mention roles and remote work; only phrases a vacancy never uses.
 */
const PROMO_PATTERNS: RegExp[] = [
  /помо(?:жем|жет|жешь|гу|гаем|гает)\s+(?:тебе\s+|вам\s+)?(?:быстрее\s+)?(?:найти|получить)\s+(?:работу|оффер)/iu,
  /(?<![\p{L}\p{N}])(?:получи|получить|получишь)\s+(?:свой\s+|первый\s+|желанный\s+)?оффер/iu,
  /работ[ау]\s+мечты|целый\s+квест/iu,
  /автоотклик|(?:откликается|откликаться|откликнется)\s+за\s+(?:тебя|вас)/iu,
  /(?:разбор|составлю|составим|прокачать|прокачаем|улучшить)\s+(?:твоего\s+|твоё\s+|ваше(?:го)?\s+)?резюме/iu,
  /карьерн\p{L}*\s+(?:консульт|коуч|ментор|трек|сопровожд)/iu,
  /личн\p{L}*\s+ментор|промокод|вебинар|интенсив|марафон/iu,
  /онлайн-?\s?(?:школ|курс)|(?:наш\p{L}*|на)\s+курс[еаы]?(?![\p{L}])|обучени\p{L}*\s+с\s+нуля|с\s+нуля\s+до/iu,
  /с\s+(?:гарантией\s+)?трудоустройств(?:ом|а)(?![\p{L}])/iu,
];

/** True for ads of career services, courses and job-search tools. */
export function isPromoPost(text: string): boolean {
  return PROMO_PATTERNS.some((re) => re.test(text));
}

/**
 * Positive signals. A vacancy names the role it hires for; channels also
 * carry chatter, announcements and native ads that pass the deny-lists, so a
 * post must name a role and either open with it or back it with a hiring
 * marker, a requirements/conditions section or a salary.
 */
const ROLE_RE = new RegExp(
  [
    String.raw`(?<![\p{L}])(?:разработчи|программист|инженер|тестировщи|аналитик|дизайнер|архитектор|тимлид|техлид|фронтенд|фронтендер|бэкенд|бекенд|бэкендер|фулл?стек|девопс|стаж[её]р|джун|мидл|сень[оё]р|синь[оё]р|менеджер|верстальщик|администратор|продакт|проджект|рекрутер|специалист)`,
    String.raw`\b(?:developer|dev|engineer|programmer|tester|qa|aqa|sdet|devops|sre|designer|analyst|architect|lead|frontend|front-end|backend|back-end|full-?stack|fullstack|scientist|manager|intern|junior|middle|senior|principal|staff|cto|head\s+of|admin(?:istrator)?|recruiter|php|golang|python|java|android|ios|react|node(?:\.?js)?)\b`,
  ].join("|"),
  "iu",
);

const HIRING_RE =
  /#?(?<![\p{L}])(?:вакансия|ваканси[юи](?=\s*[:#\n])|ищем|ищу|требу[ею]тся|нужен|нужна|нужны|в\s+(?:нашу\s+|свою\s+)?команду|открыт\p{L}*\s+позици|позиция|заказ|тз(?![\p{L}]))|#(?:vacancy|job|hiring|вакансия)|\b(?:hiring|we(?:'re|\s+are)\s+looking|looking\s+for\s+an?|join\s+(?:our|the)\s+team|open\s+(?:position|role)|position|vacancy)\b/iu;

const SECTION_RE =
  /(?<![\p{L}])(?:требования|обязанности|задачи|условия|предлагаем|ожидаем|стек|опыт\s+(?:работы|от|с\s)|зарплат|з\/?п(?![\p{L}])|оклад|вилка|бюджет|оплата|занятость|график|удал[её]н|офис|гибрид|релокац|формат\s+работы)|\b(?:requirements|responsibilities|qualifications|we\s+offer|what\s+we\s+offer|stack|experience|salary|compensation|full[\s-]?time|part[\s-]?time|remote|hybrid|on-?site|relocation|benefits)\b/iu;

/** True when the post reads like a vacancy (role + hiring/section/salary). */
export function hasVacancySignals(text: string): boolean {
  if (ROLE_RE.test(extractTitle(text))) return true;
  if (!ROLE_RE.test(text)) return false;
  return (
    HIRING_RE.test(text) ||
    SECTION_RE.test(text) ||
    extractSalary(text).salaryCurrency !== null
  );
}

export function isLikelyVacancy(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.length >= MIN_VACANCY_LENGTH &&
    !isJunkPost(trimmed) &&
    !isResumePost(trimmed) &&
    !isPromoPost(trimmed) &&
    hasVacancySignals(trimmed)
  );
}

/** First non-empty line, stripped of markdown/emoji decoration — the title. */
export function extractTitle(text: string): string {
  const line = text
    .split("\n")
    .map((l) =>
      l
        .replace(/[*_`~#]/g, "")
        // Strip pictographic decoration (emoji), keep letters/digits/punctuation.
        .replace(/[\p{Extended_Pictographic}️‍]/gu, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .find((l) => l.length > 0);
  return (line ?? "").slice(0, 200);
}

const COMPANY_RE = /(?:компания|company)\s*[:—–-]\s*([^\n]+)/iu;
const LOCATION_RE = /(?:локация|город|location)\s*[:—–-]\s*([^\n]+)/iu;

export function extractCompany(text: string): string | null {
  const m = COMPANY_RE.exec(text);
  return m?.[1]?.replace(/[*_`]/g, "").trim() || null;
}

export function extractLocation(text: string): string | null {
  const m = LOCATION_RE.exec(text);
  return m?.[1]?.replace(/[*_`]/g, "").trim().slice(0, 120) || null;
}

export function extractWorkFormat(text: string): NewVacancy["workFormat"] {
  if (/гибрид|hybrid/iu.test(text)) return "hybrid";
  if (/удал[её]н|remote|релокац/iu.test(text)) return "remote";
  if (/офис|on-?site/iu.test(text)) return "onsite";
  return null;
}

export function extractEmploymentType(
  text: string,
): NewVacancy["employmentType"] {
  if (/part[\s-]?time|частичная\s+занятость/iu.test(text)) return "part_time";
  if (/freelance|фриланс|проектная\s+(?:работа|занятость)/iu.test(text))
    return "freelance";
  if (/full[\s-]?time|полная\s+занятость|полный\s+день/iu.test(text))
    return "full_time";
  return null;
}

const CURRENCY_BY_TOKEN: Record<string, string> = {
  $: "USD",
  usd: "USD",
  "€": "EUR",
  eur: "EUR",
  "₽": "RUB",
  руб: "RUB",
  rub: "RUB",
  "£": "GBP",
  gbp: "GBP",
  грн: "UAH",
  uah: "UAH",
};

// Plain digit runs ("5000") or explicit thousand separators ("300 000", "3,000").
const AMOUNT = String.raw`(\d+(?:[\s.,']\d{3})*(?:k|к)?)`;
const CUR = String.raw`(\$|€|₽|£|usd|eur|rub|gbp|руб|грн|uah)`;
// "3000–5000 $", "$3k-5k", "от 3000 до 5000 usd", "до 300 000 ₽", "from 3000 usd"
const SALARY_RANGE_RE = new RegExp(
  String.raw`(?:от\s+)?${CUR}?\s*${AMOUNT}\s*(?:[-–—]|до)\s*${CUR}?\s*${AMOUNT}\s*${CUR}?`,
  "iu",
);
const SALARY_FROM_RE = new RegExp(
  String.raw`(?:от|from)\s+${CUR}?\s*${AMOUNT}\s*${CUR}?`,
  "iu",
);
const SALARY_TO_RE = new RegExp(
  String.raw`(?:до|up\s+to)\s+${CUR}?\s*${AMOUNT}\s*${CUR}?`,
  "iu",
);

function parseAmount(raw: string): number | null {
  const k = /[kк]$/iu.test(raw);
  const n = Number(raw.replace(/[kк]/giu, "").replace(/[\s.,']/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  const value = k ? n * 1000 : n;
  // Guard against phone numbers / ids swallowed by the regex.
  return value >= 100 && value <= 10_000_000 ? value : null;
}

function currencyOf(...tokens: Array<string | undefined>): string | null {
  for (const t of tokens) {
    const c = t && CURRENCY_BY_TOKEN[t.toLowerCase()];
    if (c) return c;
  }
  return null;
}

export interface ParsedSalary {
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
}

export function extractSalary(text: string): ParsedSalary {
  const none: ParsedSalary = {
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
  };

  const range = SALARY_RANGE_RE.exec(text);
  if (range) {
    const [, cur1, minRaw, cur2, maxRaw, cur3] = range;
    const salaryMin = parseAmount(minRaw ?? "");
    const salaryMax = parseAmount(maxRaw ?? "");
    const salaryCurrency = currencyOf(cur1, cur2, cur3);
    // A currency marker is required: bare number ranges are usually dates/ids.
    if (salaryCurrency && (salaryMin != null || salaryMax != null)) {
      return { salaryMin, salaryMax, salaryCurrency };
    }
  }

  const from = SALARY_FROM_RE.exec(text);
  if (from) {
    const [, cur1, raw, cur2] = from;
    const salaryMin = parseAmount(raw ?? "");
    const salaryCurrency = currencyOf(cur1, cur2);
    if (salaryCurrency && salaryMin != null) {
      return { salaryMin, salaryMax: null, salaryCurrency };
    }
  }

  const to = SALARY_TO_RE.exec(text);
  if (to) {
    const [, cur1, raw, cur2] = to;
    const salaryMax = parseAmount(raw ?? "");
    const salaryCurrency = currencyOf(cur1, cur2);
    if (salaryCurrency && salaryMax != null) {
      return { salaryMin: null, salaryMax, salaryCurrency };
    }
  }

  return none;
}

/** Returns null for messages that don't look like a vacancy post. */
export function normalizeTelegramMessage(
  message: TelegramMessageInput,
  sourceId: string,
): NewVacancy | null {
  const text = message.text.trim();
  if (!isLikelyVacancy(text)) return null;

  const title = extractTitle(text);
  if (!title) return null;

  // Company is often absent in channel posts; fall back to the channel handle
  // so the NOT NULL dedup key stays meaningful per channel.
  const company = extractCompany(text) ?? `@${message.channel}`;

  return {
    sourceId,
    externalId: `${message.channel}:${message.messageId}`,
    url: `https://t.me/${message.channel}/${message.messageId}`,
    title,
    companyRaw: company,
    companyNormalized: normalizeCompanyName(company),
    description: text,
    workFormat: extractWorkFormat(text),
    employmentType: extractEmploymentType(text),
    ...extractSalary(text),
    location: extractLocation(text),
    publishedAt: message.date,
  };
}

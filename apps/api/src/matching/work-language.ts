import type { Language } from '@jobradar/shared';

/**
 * Which language a vacancy's work is in (v2.7.0, ADR-033), read from the
 * posting itself with no LLM (ADR-025, ADR-029): the language the text is
 * written in, by counting each language's function words, plus the languages
 * it explicitly asks for ("fluent German", "inglés C1", "знание польского").
 *
 * The languages are the ones the bot's postings arrive in; a posting in any
 * other one reads as "could not tell", which never hides it.
 */

export const WORK_LANGUAGES = ['en', 'ru', 'uk', 'es', 'de', 'fr', 'pt', 'it', 'pl', 'nl'] as const;
export type WorkLanguage = (typeof WORK_LANGUAGES)[number];

/**
 * A new user's working languages: the audience reads English, Russian and
 * Ukrainian, and DOU and Djinni post in Ukrainian. One tap in /filters changes it.
 */
export const DEFAULT_WORK_LANGUAGES: WorkLanguage[] = ['en', 'ru', 'uk'];

export interface VacancyLanguages {
  /** Languages the posting is written in, the main one first; empty = could not tell. */
  text: WorkLanguage[];
  /** Languages it requires outright; a "nice to have" does not count. */
  required: WorkLanguage[];
}

export const NO_LANGUAGES: VacancyLanguages = { text: [], required: [] };

const LABELS: Record<WorkLanguage, Record<Language, string>> = {
  en: { en: 'English', ru: 'Английский' },
  ru: { en: 'Russian', ru: 'Русский' },
  uk: { en: 'Ukrainian', ru: 'Украинский' },
  es: { en: 'Spanish', ru: 'Испанский' },
  de: { en: 'German', ru: 'Немецкий' },
  fr: { en: 'French', ru: 'Французский' },
  pt: { en: 'Portuguese', ru: 'Португальский' },
  it: { en: 'Italian', ru: 'Итальянский' },
  pl: { en: 'Polish', ru: 'Польский' },
  nl: { en: 'Dutch', ru: 'Нидерландский' },
};

export function languageLabel(code: WorkLanguage, lang: Language): string {
  return LABELS[code][lang] ?? LABELS[code].en;
}

export function isWorkLanguage(value: string | undefined): value is WorkLanguage {
  return (WORK_LANGUAGES as readonly string[]).includes(value ?? '');
}

// ---------------------------------------------------------------------------
// The text's own language
// ---------------------------------------------------------------------------

/**
 * Function words, and a few job-posting words, that are frequent in one
 * language and rare in the others. Technology names are English in every
 * posting, so only words around them say what the posting is written in.
 */
const STOPWORDS: Record<WorkLanguage, string[]> = {
  en: ['the', 'and', 'with', 'you', 'your', 'our', 'will', 'are', 'for', 'this', 'that', 'we', 'have', 'is', 'of', 'to', 'be', 'who', 'about', 'from', 'job', 'work', 'description', 'flexible', 'company', 'an', 'its'],
  ru: ['и', 'с', 'из', 'к', 'от', 'что', 'это', 'как', 'или', 'мы', 'вы', 'опыт', 'работы', 'работа', 'будет', 'ищем', 'задачи', 'требования', 'компании', 'также', 'условия', 'обязанности', 'знание', 'уровень', 'есть', 'чем', 'ищет', 'компания', 'занятость', 'удалённо', 'удаленно', 'откликнуться', 'вакансии', 'вакансию', 'описание', 'формат', 'гибкий', 'график', 'полная'],
  uk: ['і', 'й', 'з', 'із', 'від', 'що', 'це', 'як', 'або', 'ми', 'ви', 'досвід', 'роботи', 'робота', 'буде', 'шукаємо', 'завдання', 'вимоги', 'компанії', 'також', 'умови', 'знання', 'рівень', 'та', 'компанія', 'зайнятість', 'віддалено', 'відгукнутися', 'вакансії', 'опис', 'графік', 'повна'],
  es: ['el', 'los', 'las', 'del', 'y', 'con', 'para', 'por', 'una', 'es', 'nuestro', 'nuestra', 'experiencia', 'trabajo', 'equipo', 'buscamos', 'desarrollo', 'más', 'empresa', 'como', 'al', 'sus', 'conocimientos', 'ofrecemos'],
  pt: ['os', 'do', 'da', 'dos', 'das', 'em', 'com', 'uma', 'não', 'nosso', 'nossa', 'experiência', 'trabalho', 'equipe', 'você', 'vaga', 'desenvolvimento', 'mais', 'para', 'conhecimento', 'oferecemos', 'ao'],
  de: ['der', 'die', 'das', 'und', 'mit', 'für', 'wir', 'sie', 'ist', 'ein', 'eine', 'zu', 'von', 'auf', 'im', 'den', 'dem', 'nicht', 'auch', 'bei', 'oder', 'unser', 'unsere', 'erfahrung', 'kenntnisse', 'bieten'],
  fr: ['le', 'les', 'des', 'et', 'avec', 'pour', 'nous', 'vous', 'est', 'une', 'du', 'au', 'dans', 'sur', 'qui', 'votre', 'notre', 'expérience', 'équipe', 'poste', 'travail', 'vos'],
  it: ['il', 'gli', 'della', 'delle', 'di', 'per', 'che', 'è', 'non', 'nostro', 'nostra', 'esperienza', 'lavoro', 'siamo', 'cerchiamo', 'sviluppo', 'nel', 'alla', 'sono', 'offriamo'],
  pl: ['w', 'się', 'jest', 'oraz', 'dla', 'nie', 'że', 'jak', 'lub', 'od', 'przez', 'doświadczenie', 'pracy', 'zespół', 'szukamy', 'będzie', 'znajomość', 'mamy', 'oferujemy', 'naszym', 'twoje'],
  nl: ['het', 'een', 'en', 'van', 'voor', 'met', 'wij', 'jij', 'ons', 'onze', 'ervaring', 'werk', 'bent', 'zijn', 'bij', 'ook', 'naar'],
};

/**
 * Job-title words, worth several function words each: on LinkedIn the title is
 * all the alert carries. English has none here, since an English title heads
 * postings in every language and says nothing about the text.
 */
const TITLE_WORDS: Partial<Record<WorkLanguage, RegExp>> = {
  ru: /(?<!\p{L})(?:разработчи\p{L}*|программист\p{L}*|инженер\p{L}*|верстальщи\p{L}*)/iu,
  uk: /(?<!\p{L})(?:розробни\p{L}*|програміст\p{L}*|інженер\p{L}*)/iu,
  es: /(?<!\p{L})(?:desarrollador\p{L}*|programador\p{L}*|ingenier[oa]s?|arquitect[oa])(?!\p{L})/iu,
  pt: /(?<!\p{L})(?:desenvolvedor\p{L}*|engenheir[oa]s?)(?!\p{L})/iu,
  de: /(?<!\p{L})(?:\p{L}*entwickler(?:in)?|ingenieur(?:in)?)(?!\p{L})|\((?:m\/w\/d|w\/m\/d|m\/w\/x|d\/m\/w)\)/iu,
  fr: /(?<!\p{L})(?:développeu(?:r|se)s?|ingénieure?s?)(?!\p{L})|\((?:h\/f|f\/h)\)/iu,
  it: /(?<!\p{L})(?:sviluppat(?:ore|rice)|programmat(?:ore|rice)|ingegnere)(?!\p{L})/iu,
  pl: /(?<!\p{L})(?:programist(?:a|ka)|inżynier\p{L}*)(?!\p{L})/iu,
  nl: /(?<!\p{L})(?:ontwikkelaar)(?!\p{L})/iu,
};
const TITLE_WEIGHT = 3;

/** Fewer hits than this is too little text to call a language. */
const MIN_HITS = 3;
/** A second language counts when it has this share of the main one's hits (a bilingual posting). */
const SECOND_SHARE = 0.4;
/** Enough of the posting to tell its language; the rest only costs time. */
const TEXT_SCAN_CHARS = 4000;

const STOPWORD_SETS = Object.fromEntries(
  WORK_LANGUAGES.map((code) => [code, new Set(STOPWORDS[code])]),
) as Record<WorkLanguage, Set<string>>;

/** The languages a posting is written in, the main one first; empty when it cannot tell. */
export function detectTextLanguages(title: string, description: string): WorkLanguage[] {
  const hits = Object.fromEntries(WORK_LANGUAGES.map((code) => [code, 0])) as Record<WorkLanguage, number>;
  const words = `${title}\n${description.slice(0, TEXT_SCAN_CHARS)}`.toLowerCase().match(/\p{L}+/gu) ?? [];
  for (const word of words) {
    for (const code of WORK_LANGUAGES) if (STOPWORD_SETS[code].has(word)) hits[code] += 1;
  }
  for (const [code, pattern] of Object.entries(TITLE_WORDS) as [WorkLanguage, RegExp][]) {
    if (pattern.test(title)) hits[code] += TITLE_WEIGHT;
  }

  const ranked = WORK_LANGUAGES.filter((code) => hits[code] >= MIN_HITS).sort(
    (a, b) => hits[b] - hits[a],
  );
  const top = ranked[0];
  if (!top) return [];
  return ranked.filter((code) => code === top || hits[code] >= hits[top] * SECOND_SHARE);
}

// ---------------------------------------------------------------------------
// Languages the posting asks for
// ---------------------------------------------------------------------------

/** Each language's name as postings in the ten languages spell it; matched against one word. */
const NAMES: Record<WorkLanguage, string> = {
  en: 'english|englisch|anglais|inglese|ingl[eéê]s|angielsk\\p{L}*|английск\\p{L}*|англійськ\\p{L}*|engels',
  ru: 'russian|russisch|russe|russo|ruso|rosyjsk\\p{L}*|русск\\p{L}*|російськ\\p{L}*|russisch',
  uk: 'ukrainian|ukrainisch|ukrainien|ucraniano|ucraino|ukraińsk\\p{L}*|украинск\\p{L}*|українськ\\p{L}*|oekraïens',
  es: 'spanish|spanisch|espagnol|spagnolo|espa[nñ]ol|castellano|espanhol|hiszpańsk\\p{L}*|испанск\\p{L}*|іспанськ\\p{L}*|spaans',
  de: 'german|deutsch|allemand|tedesco|alem[aá]n|alemão|niemieck\\p{L}*|немецк\\p{L}*|німецьк\\p{L}*|duits',
  fr: 'french|französisch|fran[cç]ais|francese|franc[eéê]s|francusk\\p{L}*|французск\\p{L}*|французьк\\p{L}*',
  pt: 'portuguese|portugiesisch|portugais|portoghese|portugu[eéê]s|portugalsk\\p{L}*|португальск\\p{L}*|португальськ\\p{L}*',
  it: 'italian|italienisch|italien|italiano|italiaans|włosk\\p{L}*|итальянск\\p{L}*|італійськ\\p{L}*',
  pl: 'polish|polnisch|polonais|polacco|polaco|polski|polskiego|polskim|польск\\p{L}*|польськ\\p{L}*|pools',
  nl: 'dutch|niederländisch|néerlandais|olandese|neerland[eé]s|holand[eé]s|nederlands|niderlandzk\\p{L}*|нидерландск\\p{L}*|голландск\\p{L}*|нідерландськ\\p{L}*',
};
const NAME_PATTERNS = Object.fromEntries(
  WORK_LANGUAGES.map((code) => [code, new RegExp(`^(?:${NAMES[code]})$`, 'iu')]),
) as Record<WorkLanguage, RegExp>;

/** "German-speaking", "Deutschkenntnisse", "русскоязычный": the name and the requirement in one word. */
const SPEAKING_SUFFIX = /^(.+?)(?:-speaking|-speaker|-speakers|kenntnisse|sprachig\p{L}*|язычн\p{L}*|мовн\p{L}*)$/iu;
const RU_SPEAKING: Partial<Record<string, WorkLanguage>> = {
  русско: 'ru', англо: 'en', украино: 'uk', испано: 'es', немецко: 'de', франко: 'fr', польско: 'pl',
  російсько: 'ru', англомовн: 'en', україно: 'uk',
};

/** A level or a word that says the language is needed, before or right after its name. */
const LEVEL = new RegExp(
  '^(?:' +
    [
      '[abc][12]\\+?', 'native', 'fluent(?:ly)?', 'fluency', 'proficien\\p{L}*', 'advanced', 'upper-intermediate',
      'intermediate', 'business', 'professional', 'excellent', 'strong', 'good', 'working', 'conversational',
      'written', 'spoken', 'level',
      'свободн\\p{L}*', 'разговорн\\p{L}*', 'уверенн\\p{L}*', 'хорош\\p{L}*', 'отличн\\p{L}*', 'продвинут\\p{L}*',
      'родн\\p{L}*', 'знани\\p{L}*', 'владени\\p{L}*', 'уровн\\p{L}*', 'носител\\p{L}*',
      'вільн\\p{L}*', 'впевнен\\p{L}*', 'знання', 'володінн\\p{L}*', 'рівн\\p{L}*',
      'fluid[oa]', 'avanzad[oa]', 'nativ[oa]', 'nivel', 'dominio', 'alto',
      'fließend\\p{L}*', 'verhandlungssicher\\p{L}*', 'gute?n?', 'muttersprach\\p{L}*', 'sehr',
      'courant', 'couramment', 'natif', 'bilingue', 'maîtrise', 'niveau', 'bonne?',
      'fluente', 'fluência', 'avançado', 'nível', 'domínio',
      'ottim\\p{L}*', 'buona', 'madrelingua', 'livello', 'padronanza', 'conoscenza',
      'biegł\\p{L}*', 'znajomość', 'dobra', 'poziom\\p{L}*', 'płynn\\p{L}*',
      'vloeiend', 'goede', 'beheersing',
    ].join('|') +
    ')$',
  'iu',
);
const REQUIRED = new RegExp(
  '^(?:' +
    [
      'required', 'must', 'mandatory', 'essential', 'обязательн\\p{L}*', 'необходим\\p{L}*', "обов['’]язков\\p{L}*",
      'необхідн\\p{L}*', 'necesari[oa]', 'requerid[oa]', 'imprescindible', 'indispensable', 'erforderlich',
      'voraussetzung', 'obligatoire', 'exigée?', 'obrigatório', 'richiest[oa]', 'wymagan\\p{L}*', 'vereist',
    ].join('|') +
    ')$',
  'iu',
);
/** "Nice to have": a clause saying this is not a requirement. */
const PLUS =
  /(?<!\p{L})(?:plus|nice to have|bonus|advantage|preferred|desirable|optional|плюс\p{L}*|преимуществ\p{L}*|желательн\p{L}*|перевага|бажан\p{L}*|deseable|valorable|se valora|von vorteil|wünschenswert|atout|apprécié|diferencial|desejável|gradito|preferibile|mile widzian\p{L}*|atut)(?!\p{L})/iu;
/** Words between a level and the name that do not change the meaning ("English language at B2"). */
const FILLER = /^(?:language|languages|skills|язык\p{L}*|мов\p{L}*|idioma|sprache|langue|lingua|język\p{L}*|taal|на|в|at|in|of|de|en|is|a|an|and|и|та|y|und|et|e|i)$/iu;

/** Words a level may sit before the name, and a requirement after it. */
const BEFORE = 3;
const AFTER = 3;
/** Enough of the posting for its requirements section. */
const REQUIREMENT_SCAN_CHARS = 8000;

function nameOf(word: string): WorkLanguage | null {
  for (const code of WORK_LANGUAGES) if (NAME_PATTERNS[code].test(word)) return code;
  return null;
}

/** The languages a posting requires: a name next to a level or a "required", outside a "nice to have". */
export function detectRequiredLanguages(text: string): WorkLanguage[] {
  const found = new Set<WorkLanguage>();
  // Commas split too: "fluent English, French is a plus" is two requirements.
  const clauses = text.slice(0, REQUIREMENT_SCAN_CHARS).split(/[.;!?\n•|·]+|,\s+/u);
  for (const clause of clauses) {
    if (PLUS.test(clause)) continue;
    const words = (clause.match(/[\p{L}\p{N}+'’-]+/gu) ?? []).filter((word) => !/^[-+]+$/.test(word));
    words.forEach((word, index) => {
      const speaking = SPEAKING_SUFFIX.exec(word);
      if (speaking) {
        const stem = speaking[1]!.replace(/-$/, '');
        const code = nameOf(stem) ?? RU_SPEAKING[stem.toLowerCase()] ?? null;
        if (code) found.add(code);
        return;
      }
      const code = nameOf(word);
      if (!code) return;
      const before = words.slice(Math.max(0, index - BEFORE - 1), index).filter((w) => !FILLER.test(w)).slice(-BEFORE);
      const after = words.slice(index + 1, index + 1 + AFTER + 2).filter((w) => !FILLER.test(w)).slice(0, AFTER);
      const levelled =
        before.some((w) => LEVEL.test(w) || REQUIRED.test(w)) ||
        after.slice(0, 2).some((w) => LEVEL.test(w)) ||
        after.some((w) => REQUIRED.test(w));
      if (levelled) found.add(code);
    });
  }
  return WORK_LANGUAGES.filter((code) => found.has(code));
}

/**
 * Both readings of one posting. `titleOnly` is for a LinkedIn alert, whose
 * stored description is a summary JobRadar wrote in English (ADR-021).
 */
export function detectVacancyLanguages(
  vacancy: { title: string; description: string },
  titleOnly = false,
): VacancyLanguages {
  const description = titleOnly ? '' : vacancy.description;
  return {
    text: detectTextLanguages(vacancy.title, description),
    required: detectRequiredLanguages(`${vacancy.title}\n${description}`),
  };
}

/** Every language the work needs, written-in first, for the card's 🗣 row. */
export function vacancyLanguageList(languages: VacancyLanguages): WorkLanguage[] {
  return [...new Set([...languages.text, ...languages.required])];
}

/**
 * Whether the user can do this job. Nothing chosen = any language. The posting
 * must be written in one of the user's languages (a bilingual one in either)
 * and require none outside them. A posting whose language could not be told
 * passes: no evidence is not evidence against it.
 */
export function matchesWorkLanguages(wanted: readonly string[], languages: VacancyLanguages): boolean {
  if (wanted.length === 0) return true;
  if (languages.text.length > 0 && !languages.text.some((code) => wanted.includes(code))) return false;
  return languages.required.every((code) => wanted.includes(code));
}

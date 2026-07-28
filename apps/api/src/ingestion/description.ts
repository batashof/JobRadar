/**
 * Shared description sanitizing for every job-board worker.
 *
 * Feeds ship HTML, double-encoded entities, mojibake and board boilerplate
 * (cookie banners, "mention the word X when applying" anti-spam footers). None
 * of that is vacancy text: it pollutes the feed UI, the resume-matching prompt
 * and the apply-contact extractor, so it is removed once, here, before a row
 * reaches `upsertVacancies`.
 */

/**
 * A cleaned description shorter than this is not a vacancy — it is a scraped
 * page fragment, a cookie notice or an empty stub. Real postings across every
 * active board start at ~1200 characters, so the gate is generous by design.
 */
export const MIN_DESCRIPTION_LENGTH = 200;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  bull: '•',
  middot: '·',
  euro: '€',
  pound: '£',
  copy: '©',
  reg: '®',
  trade: '™',
};

/** Named + numeric HTML entities. Unknown entities are dropped, not kept raw. */
function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|\w+);/gi, (match, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1]?.toLowerCase() === 'x'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : ' ';
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? ' ';
  });
}

/** Typical UTF-8-read-as-Latin-1/CP1252 sequences: "Â£45k", "childrenâ€™s". */
const MOJIBAKE_RE = /Ã[\u0080-\u00bf]|â[\u0080-\u009f\u20ac\u2122\u201a-\u201e]|Â[\u00a0-\u00bf]/;

/** CP1252 renderings of bytes 0x80–0x9F, which Latin-1 leaves undefined. */
const CP1252_BYTES: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85,
  '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a,
  '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92,
  '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c,
  'ž': 0x9e, 'Ÿ': 0x9f,
};

/**
 * Some feeds (RemoteOK notably) serve UTF-8 bytes that were already decoded as
 * Latin-1 or CP1252 upstream. Re-encoding recovers the original text, but only
 * when every character maps back to a single byte — otherwise the text is
 * genuine non-Latin (Cyrillic, CJK) and re-encoding would destroy it.
 */
function repairMojibake(value: string): string {
  if (!MOJIBAKE_RE.test(value)) return value;

  const bytes: number[] = [];
  for (const char of value) {
    const code = char.codePointAt(0)!;
    const byte = code <= 0xff ? code : CP1252_BYTES[char];
    if (byte === undefined) return value;
    bytes.push(byte);
  }

  const repaired = Buffer.from(bytes).toString('utf8');
  return repaired.includes('�') ? value : repaired;
}

/**
 * HTML → plain text. Entities are decoded before tags are stripped, twice:
 * some feeds (Arbeitnow, WordPress-backed boards) double-encode their markup as
 * `&lt;p&gt;`, which only becomes a tag after the first decode.
 */
export function stripHtml(value: string): string {
  let text = value;
  for (let pass = 0; pass < 2; pass += 1) {
    text = decodeEntities(text).replace(/<[^>]+>/g, ' ');
  }
  return repairMojibake(text).replace(/\s+/g, ' ').trim();
}

/**
 * Board boilerplate appended to (or standing in for) the posting body. Applied
 * to plain text, after `stripHtml`.
 */
const BOILERPLATE_PATTERNS: RegExp[] = [
  // RemoteOK anti-spam footer, present on every item of their public feed:
  // "Please mention the word **AMICABILITY** and tag RNzQuMjIw… when applying
  // to show you read the job post completely (#RNzQuMjIw…). This is a beta
  // feature to avoid spam applicants. Companies can search these words to find
  // applicants that read this and see they're human."
  /Please mention the word[\s\S]{0,400}?see they(?:'|’)re human\.?/i,
  // Same footer with a truncated head — anchor on the tail alone.
  /This is a beta feature to avoid spam applicants\.[\s\S]{0,300}?human\.?/i,
  /Please mention the word\s+\*{0,2}[A-Z]+\*{0,2}\s+and tag\s+\S+\s+when applying[^.]*\./i,
  // Cookie / privacy banners scraped along with the page body.
  /(?:This|Our)\s+website\s+uses\s+cookies[\s\S]{0,300}?(?:Privacy|Cookie)\s+Policy\.?/i,
  /We\s+use\s+cookies\s+to[\s\S]{0,200}?(?:Privacy|Cookie)\s+Policy\.?/i,
  /By\s+using\s+this\s+website,\s+you\s+agree\s+to\s+our\s+use\s+of\s+cookies[^.]*\./i,
  // Boards that staple their own apply CTA onto the feed body.
  /To\s+apply[,:]?\s+(?:please\s+)?visit\s+the\s+following\s+link[^.]*\./i,
];

/** HTML-stripped, boilerplate-free plain text; `''` for missing input. */
export function cleanDescription(raw?: string | null): string {
  if (!raw) return '';
  let text = stripHtml(raw);
  for (const pattern of BOILERPLATE_PATTERNS) {
    text = text.replace(pattern, ' ');
  }
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Quality gate every board worker applies: an item whose description is nothing
 * but boilerplate is junk, not a vacancy. Takes the *raw* feed value.
 */
export function hasSubstantialDescription(raw?: string | null): boolean {
  return cleanDescription(raw).length >= MIN_DESCRIPTION_LENGTH;
}

import {
  extractCompany,
  extractHeader,
  extractTitle,
  extractWorkFormat,
  isHnJobComment,
  normalizeHnComment,
  type HnComment,
} from './hn-normalize';

const SOURCE_ID = '00000000-0000-0000-0000-000000000009';
const STORY_ID = 48747976;

const BODY = 'We are a small team building payment rails. '.repeat(6);

const comment: HnComment = {
  objectID: '48913532',
  parent_id: STORY_ID,
  story_id: STORY_ID,
  author: 'someone',
  comment_text:
    'Chronograph (chronograph.pe) | Platform Engineer | Full-Time | Remote (US) | ' +
    `$175,000 - $215,000 USD + equity<p>${BODY}`,
  created_at: '2026-07-15T09:12:00.000Z',
};

const segments = (header: string): string[] =>
  header
    .split('|')
    .map((p) => p.trim())
    .filter(Boolean);

describe('hn header parsing', () => {
  it('takes the header from the first paragraph only', () => {
    expect(extractHeader(comment.comment_text!)).toBe(
      'Chronograph (chronograph.pe) | Platform Engineer | Full-Time | Remote (US) | $175,000 - $215,000 USD + equity',
    );
  });

  it('picks the segment that reads like a role', () => {
    expect(extractTitle(segments('Acme | Senior Backend Engineer | REMOTE | Full-time'))).toBe(
      'Senior Backend Engineer',
    );
  });

  it('returns no title when the header names no role', () => {
    expect(extractTitle(segments('Marketron | REMOTE (US) | Full-time | 70k - 90k'))).toBe('');
  });

  it('strips a trailing site from the company and skips it when the post leads with the role', () => {
    expect(extractCompany(segments('Chronograph (chronograph.pe) | Platform Engineer'))).toBe(
      'Chronograph',
    );
    expect(extractCompany(segments('Full Stack Developer | REMOTE | Part-time'))).toBeNull();
  });

  it('prefers remote when several formats are offered', () => {
    expect(extractWorkFormat('Acme | Dev | REMOTE or ONSITE')).toBe('remote');
    expect(extractWorkFormat('Acme | Dev | Hybrid (2 days/week onsite)')).toBe('hybrid');
    expect(extractWorkFormat('Acme | Dev | San Francisco, CA | ONSITE')).toBe('onsite');
    expect(extractWorkFormat('Acme | Dev | Full-time')).toBeNull();
  });
});

describe('isHnJobComment', () => {
  it('keeps substantial top-level comments only', () => {
    expect(isHnJobComment(comment, STORY_ID)).toBe(true);
    // A reply, not a job post.
    expect(isHnJobComment({ ...comment, parent_id: 48913000 }, STORY_ID)).toBe(false);
    expect(isHnJobComment({ ...comment, comment_text: 'Is this still open?' }, STORY_ID)).toBe(
      false,
    );
  });
});

describe('normalizeHnComment', () => {
  it('maps a conventional post to the vacancy shape', () => {
    const row = normalizeHnComment(comment, SOURCE_ID)!;
    expect(row).toMatchObject({
      sourceId: SOURCE_ID,
      externalId: 'hn:48913532',
      url: 'https://news.ycombinator.com/item?id=48913532',
      title: 'Platform Engineer',
      companyRaw: 'Chronograph',
      workFormat: 'remote',
      employmentType: 'full_time',
      salaryMin: 175000,
      salaryMax: 215000,
      salaryCurrency: 'USD',
      location: 'Remote (US)',
    });
    expect(row.description).toContain('payment rails');
    expect(row.publishedAt).toEqual(new Date('2026-07-15T09:12:00.000Z'));
  });

  it('drops onsite-only posts — this is a remote-work radar', () => {
    const onsite = {
      ...comment,
      comment_text: `TypeSafe AI | AI Engineer | San Francisco, CA | ONSITE | Full-time<p>${BODY}`,
    };
    expect(normalizeHnComment(onsite, SOURCE_ID)).toBeNull();
  });

  it('drops posts whose header names no role', () => {
    const roleless = {
      ...comment,
      comment_text: `Marketron | REMOTE (US) | Full-time | 70k - 90k<p>${BODY}`,
    };
    expect(normalizeHnComment(roleless, SOURCE_ID)).toBeNull();
  });

  it('falls back to Unknown company without inventing one', () => {
    const noCompany = {
      ...comment,
      comment_text: `Founding Full Stack Developer | REMOTE | Part-time | $0 + equity<p>${BODY}`,
    };
    const row = normalizeHnComment(noCompany, SOURCE_ID)!;
    expect(row.companyRaw).toBe('Unknown');
    expect(row.title).toBe('Founding Full Stack Developer');
    expect(row.employmentType).toBe('part_time');
  });

  it('leaves monthly rates out of the salary filters', () => {
    const monthly = {
      ...comment,
      comment_text: `Acme | Full-stack Developer | Remote LATAM | $3.5k&#x2F;mo<p>${BODY}`,
    };
    const row = normalizeHnComment(monthly, SOURCE_ID)!;
    expect(row.salaryMin).toBeNull();
    expect(row.salaryCurrency).toBeNull();
  });
});

import { TelegramApiError } from '../bot/telegram-api';
import {
  errorFingerprint,
  feedbackTitle,
  type IssueSource,
  isTransientError,
  issueBody,
  issueTitle,
  redact,
  renderTriage,
  TRIAGE_LIMIT,
  type TriageItem,
} from './triage-logic';

const item = (over: Partial<TriageItem> = {}): TriageItem => ({
  id: 12,
  kind: 'error',
  title: 'button s:open',
  detail: 'answerCallbackQuery failed: fetch failed',
  count: 1,
  transient: false,
  status: 'new',
  unseen: true,
  ...over,
});

describe('isTransientError', () => {
  it.each([
    new Error('answerCallbackQuery failed: fetch failed'),
    new Error('sendMessage failed: fetch failed (ECONNRESET)'),
    new Error('The operation was aborted due to timeout'),
    new Error('Connection terminated unexpectedly'),
    new TelegramApiError('sendMessage', 429, 'Too Many Requests: retry after 3', 3),
    new TelegramApiError('editMessageText', 502, 'Bad Gateway'),
  ])('treats %s as transient', (err) => {
    expect(isTransientError(err)).toBe(true);
  });

  it.each([
    new TypeError("Cannot read properties of undefined (reading 'id')"),
    new TelegramApiError('editMessageText', 400, "Bad Request: can't parse entities"),
    new Error('duplicate key value violates unique constraint'),
  ])('treats %s as a bug', (err) => {
    expect(isTransientError(err)).toBe(false);
  });
});

describe('errorFingerprint', () => {
  it('groups occurrences that differ only in ids and numbers', () => {
    const a = errorFingerprint('/digest', 'user 1688d3c8-6de0-44a3-8a6f-e7d761da335f: 12 rows');
    const b = errorFingerprint('/digest', 'user 00000000-0000-0000-0000-000000000000: 3 rows');
    expect(a).toBe(b);
    expect(a).toBe('error:/digest|user <id>: N rows');
  });

  it('keeps faults of different places apart', () => {
    expect(errorFingerprint('/resume', 'x')).not.toBe(errorFingerprint('/digest', 'x'));
  });
});

describe('redact', () => {
  it('removes contacts before the text can reach a public issue', () => {
    expect(redact('write me at anna.k@mail.com or @anna_k, +375 29 123-45-67, t.me/anna')).toBe(
      'write me at [email] or [user], [phone], [telegram]',
    );
  });

  it('leaves ordinary text and short numbers alone', () => {
    expect(redact('5 vacancies in 2 days, React 19')).toBe('5 vacancies in 2 days, React 19');
  });
});

describe('feedbackTitle', () => {
  it('takes the first line, shortened', () => {
    expect(feedbackTitle('Short one\nmore')).toBe('Short one');
    expect(feedbackTitle('x'.repeat(80))).toHaveLength(60);
  });
});

describe('renderTriage', () => {
  it('lists errors and feedback with fix and skip buttons', () => {
    const { text, keyboard } = renderTriage(
      'ru',
      [item({ count: 3 }), item({ id: 13, kind: 'feedback', title: 'нет Go', detail: 'нет вакансий по <Go>' })],
      { quietTransient: 0, inProgress: 0 },
    );
    expect(text).toContain('🧰 Баги и отзывы: открыто 2');
    expect(text).toContain('<b>#12</b> ⚠️ <code>button s:open</code> ×3');
    expect(text).toContain('<b>#13</b> 💬 нет вакансий по &lt;Go&gt;');
    expect(keyboard).toEqual([
      [
        { text: '🛠 #12', callbackData: 't:f:12' },
        { text: '🙈 #12', callbackData: 't:s:12' },
      ],
      [
        { text: '🛠 #13', callbackData: 't:f:13' },
        { text: '🙈 #13', callbackData: 't:s:13' },
      ],
    ]);
  });

  it('shows a marked item with an undo button', () => {
    const { text, keyboard } = renderTriage('en', [item({ status: 'fix', transient: true })], {
      quietTransient: 0,
      inProgress: 0,
    });
    expect(text).toContain('🛠 <i>to be fixed</i> ⚡');
    expect(keyboard[0]?.map((b) => b.callbackData)).toEqual(['t:n:12', 't:s:12']);
  });

  it('caps the list and adds the quiet faults and the fixer queue as counts', () => {
    const many = Array.from({ length: TRIAGE_LIMIT + 2 }, (_, i) => item({ id: i + 1 }));
    const { text, keyboard } = renderTriage('en', many, { quietTransient: 4, inProgress: 2 });
    expect(keyboard).toHaveLength(TRIAGE_LIMIT);
    expect(text).toContain('…and 2 more');
    expect(text).toContain('Temporary network faults in 24 h: 4');
    expect(text).toContain('With the fixer: 2');
  });

  it('says so when nothing is open', () => {
    const { text, keyboard } = renderTriage('en', [], { quietTransient: 0, inProgress: 0 });
    expect(text).toBe('🧰 No open bugs or feedback.');
    expect(keyboard).toEqual([]);
  });

  it('stays under Telegram\'s message limit at the cap', () => {
    const many = Array.from({ length: TRIAGE_LIMIT }, (_, i) =>
      item({ id: 1000 + i, title: 'x'.repeat(80), detail: 'y'.repeat(1000) }),
    );
    expect(renderTriage('ru', many, { quietTransient: 99, inProgress: 99 }).text.length).toBeLessThan(4096);
  });
});

describe('issueTitle / issueBody', () => {
  const seen = { firstSeenAt: new Date('2026-10-30T22:00:00Z'), lastSeenAt: new Date('2026-10-30T23:00:00Z') };

  it('describes an error with its counts and the fixer instructions', () => {
    const source: IssueSource = { ...item({ count: 3 }), ...seen };
    expect(issueTitle(source)).toBe('Bot error: button s:open — answerCallbackQuery failed: fetch failed');
    const body = issueBody(source);
    expect(body).toContain('Seen: 3 time(s), first 2026-10-30 22:00 UTC');
    expect(body).toContain('Fixes #<this issue>');
    expect(body).toContain('answerCallbackQuery failed: fetch failed');
  });

  it('publishes feedback without contacts and cannot break out of its code block', () => {
    const source: IssueSource = {
      ...item({ kind: 'feedback', detail: 'Mail me: a@b.io ```rm -rf```' }),
      ...seen,
    };
    expect(issueTitle(source)).toBe('Feedback: Mail me: [email] ```rm -rf```');
    const body = issueBody(source);
    expect(body).not.toContain('a@b.io');
    expect(body.match(/```/g)).toHaveLength(2);
  });
});

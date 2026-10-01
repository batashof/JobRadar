import { ALERT_HTML, ALERT_TEXT } from './fixtures';
import {
  extractAlertQuery,
  extractJobId,
  parseAlertHtml,
  parseAlertText,
  parseLinkedInAlert,
} from './linkedin-alert-parse';

describe('extractJobId', () => {
  it.each([
    ['https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abc', '4012345678'],
    ['https://www.linkedin.com/jobs/view/4012345678', '4012345678'],
    ['https://ru.linkedin.com/jobs/view/senior-frontend-engineer-at-acme-4012345678?x=1', '4012345678'],
  ])('reads the id from %s', (href, id) => {
    expect(extractJobId(href)).toBe(id);
  });

  it.each([
    'https://www.linkedin.com/comm/jobs/search?keywords=frontend',
    'https://www.linkedin.com/comm/jobs/alerts?unsubscribe=1',
    'https://www.linkedin.com/company/12345678',
  ])('ignores links that are not a posting: %s', (href) => {
    expect(extractJobId(href)).toBeNull();
  });
});

describe('parseAlertHtml', () => {
  const jobs = parseAlertHtml(ALERT_HTML);

  it('reads one card per posting, in email order, skipping footer links', () => {
    expect(jobs.map((j) => j.jobId)).toEqual(['4012345678', '4012345679', '4012345680']);
  });

  it('takes the title from the text link, not the logo link, entities decoded', () => {
    expect(jobs.map((j) => j.title)).toEqual([
      'Senior Frontend Engineer',
      'Staff React Developer & Tech Lead',
      'Frontend Engineer (TypeScript)',
    ]);
  });

  it('splits the "Company · Location" line', () => {
    expect(jobs[0]).toMatchObject({ company: 'Acme GmbH', location: 'Berlin, Germany (Remote)' });
    expect(jobs[1]).toMatchObject({ company: 'Globex', location: 'European Union (Hybrid)' });
    expect(jobs[2]).toMatchObject({
      company: 'Initech',
      location: 'Warsaw, Mazowieckie, Poland (On-site)',
    });
  });

  it('keeps the salary line and the Easy Apply flag, drops the rest of the chrome', () => {
    expect(jobs[0]).toMatchObject({ salary: '€70K/yr - €90K/yr', easyApply: true });
    expect(jobs[1]).toMatchObject({ salary: null, easyApply: false });
  });

  it('returns nothing for an email without job links', () => {
    expect(parseAlertHtml('<p>Welcome to LinkedIn</p>')).toEqual([]);
  });
});

describe('parseAlertText', () => {
  const jobs = parseAlertText(ALERT_TEXT);

  it('reads cards from the lines before each job link', () => {
    expect(jobs.map((j) => [j.jobId, j.title, j.company, j.location])).toEqual([
      ['4012345678', 'Senior Frontend Engineer', 'Acme GmbH', 'Berlin, Germany (Remote)'],
      ['4012345679', 'Staff React Developer & Tech Lead', 'Globex', 'European Union (Hybrid)'],
      ['4012345680', 'Frontend Engineer (TypeScript)', 'Initech', 'Warsaw, Mazowieckie, Poland (On-site)'],
      ['4012345681', 'Senior UI Engineer', 'Umbrella', 'Remote'],
    ]);
  });

  it('does not take the email header for the first title', () => {
    expect(jobs[0]?.title).toBe('Senior Frontend Engineer');
  });

  it('keeps salary and Easy Apply out of the positional fields', () => {
    expect(jobs[0]).toMatchObject({ salary: '€70K/yr - €90K/yr', easyApply: true });
  });
});

describe('parseLinkedInAlert', () => {
  it('uses the HTML cards and adds the ones only the text part has', () => {
    const jobs = parseLinkedInAlert({ html: ALERT_HTML, text: ALERT_TEXT });
    expect(jobs.map((j) => j.jobId)).toEqual([
      '4012345678',
      '4012345679',
      '4012345680',
      '4012345681',
    ]);
  });

  it('fills a field the HTML read missed from the text part', () => {
    const html = ALERT_HTML.replace('Acme GmbH &middot; Berlin, Germany (Remote)', '');
    const [first] = parseLinkedInAlert({ html, text: ALERT_TEXT });
    expect(first).toMatchObject({ jobId: '4012345678', company: 'Acme GmbH' });
  });

  it('falls back to the text part when there is no HTML', () => {
    expect(parseLinkedInAlert({ html: null, text: ALERT_TEXT })).toHaveLength(4);
  });

  it('returns nothing for an unrelated email', () => {
    expect(parseLinkedInAlert({ html: '<p>Hi</p>', text: 'Hi' })).toEqual([]);
  });
});

describe('extractAlertQuery', () => {
  it('reads the saved search the email was sent for', () => {
    expect(extractAlertQuery({ html: ALERT_HTML })).toBe(
      'senior frontend engineer in European Union',
    );
    expect(extractAlertQuery({ text: ALERT_TEXT })).toBe(
      'senior frontend engineer in European Union',
    );
  });

  it('is null when the email does not name one', () => {
    expect(extractAlertQuery({ text: 'Jobs you may be interested in' })).toBeNull();
  });
});

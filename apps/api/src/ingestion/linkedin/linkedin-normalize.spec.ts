import type { LinkedInAlertJob } from './linkedin-alert-parse';
import { linkedInJobUrl, normalizeLinkedInJob, splitLocation } from './linkedin-normalize';

const job: LinkedInAlertJob = {
  jobId: '4012345678',
  title: 'Senior Frontend Engineer',
  company: 'Acme GmbH',
  location: 'Berlin, Germany (Remote)',
  salary: '€70K/yr - €90K/yr',
  easyApply: true,
};

const context = {
  sourceId: '00000000-0000-0000-0000-00000000000b',
  receivedAt: new Date('2026-09-30T08:00:00Z'),
  alertQuery: 'senior frontend engineer in European Union',
};

describe('splitLocation', () => {
  it.each([
    ['Berlin, Germany (Remote)', 'Berlin, Germany', 'remote'],
    ['European Union (Hybrid)', 'European Union', 'hybrid'],
    ['Warsaw, Poland (On-site)', 'Warsaw, Poland', 'onsite'],
    ['Минск, Беларусь (Удаленно)', 'Минск, Беларусь', 'remote'],
    ['Remote', null, 'remote'],
    ['Lisbon, Portugal', 'Lisbon, Portugal', null],
  ])('%s → %s / %s', (raw, location, workFormat) => {
    expect(splitLocation(raw)).toEqual({ location, workFormat });
  });

  it('keeps a parenthesis that is not a workplace type', () => {
    expect(splitLocation('Lisbon (Area)')).toEqual({ location: 'Lisbon (Area)', workFormat: null });
  });

  it('is empty for no location', () => {
    expect(splitLocation(null)).toEqual({ location: null, workFormat: null });
  });
});

describe('normalizeLinkedInJob', () => {
  const row = normalizeLinkedInJob(job, context);

  it('keys the row on the LinkedIn job id and links the clean posting URL', () => {
    expect(row).toMatchObject({
      sourceId: context.sourceId,
      externalId: '4012345678',
      url: 'https://www.linkedin.com/jobs/view/4012345678/',
    });
    expect(linkedInJobUrl('1')).not.toContain('tracking');
  });

  it('maps company, location, workplace type and the email date', () => {
    expect(row).toMatchObject({
      title: 'Senior Frontend Engineer',
      companyRaw: 'Acme GmbH',
      companyNormalized: expect.any(String),
      location: 'Berlin, Germany',
      workFormat: 'remote',
      publishedAt: context.receivedAt,
    });
  });

  it('parses an annual salary and ignores an hourly one', () => {
    expect(row).toMatchObject({ salaryMin: 70000, salaryMax: 90000, salaryCurrency: 'EUR' });
    const hourly = normalizeLinkedInJob({ ...job, salary: '$50/hr - $60/hr' }, context);
    expect(hourly).toMatchObject({ salaryMin: null, salaryMax: null });
  });

  it('describes the card and says the full posting is on LinkedIn', () => {
    expect(row.description).toContain('Senior Frontend Engineer at Acme GmbH.');
    expect(row.description).toContain('Salary: €70K/yr - €90K/yr.');
    expect(row.description).toContain('Easy Apply on LinkedIn.');
    expect(row.description).toContain('"senior frontend engineer in European Union"');
    expect(row.description).toContain('the full posting is on LinkedIn');
  });

  it('falls back to Unknown for a card without a company', () => {
    const bare = normalizeLinkedInJob(
      { ...job, company: null, location: null, salary: null, easyApply: false },
      { ...context, alertQuery: null },
    );
    expect(bare).toMatchObject({ companyRaw: 'Unknown', location: null, workFormat: null });
    expect(bare.description).not.toContain('Salary');
  });
});

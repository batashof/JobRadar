import {
  mapAshbyEmployment,
  mapLeverEmployment,
  normalizeAshbyJob,
  normalizeGreenhouseJob,
  normalizeLeverJob,
  type AshbyJob,
  type AtsCompany,
  type GreenhouseJob,
  type LeverJob,
} from './ats-normalize';

const SOURCE_ID = '00000000-0000-0000-0000-00000000000a';
const BODY = 'You will own our Go services end to end and mentor two engineers. '.repeat(5);

describe('greenhouse', () => {
  const company: AtsCompany = { ats: 'greenhouse', token: 'gitlab', name: 'GitLab' };
  const job: GreenhouseJob = {
    id: 8503792002,
    title: 'Senior Backend Engineer',
    absolute_url: 'https://job-boards.greenhouse.io/gitlab/jobs/8503792002',
    company_name: 'GitLab',
    location: { name: 'Remote, Germany' },
    departments: [{ name: 'Core Platform' }],
    // Greenhouse serves its content HTML-entity-encoded.
    content: `&lt;div&gt;&lt;p&gt;${BODY}&lt;/p&gt;&lt;/div&gt;`,
    first_published: '2026-04-17T05:58:03-04:00',
    updated_at: '2026-07-17T08:48:22-04:00',
  };

  it('maps a remote engineering post', () => {
    const row = normalizeGreenhouseJob(job, company, SOURCE_ID)!;
    expect(row).toMatchObject({
      sourceId: SOURCE_ID,
      externalId: 'greenhouse:gitlab:8503792002',
      url: 'https://job-boards.greenhouse.io/gitlab/jobs/8503792002',
      title: 'Senior Backend Engineer',
      companyRaw: 'GitLab',
      workFormat: 'remote',
      location: 'Remote, Germany',
    });
    // The double-encoded markup must survive as readable text.
    expect(row.description).toContain('own our Go services');
    expect(row.description).not.toContain('&lt;');
    expect(row.publishedAt).toEqual(new Date('2026-04-17T05:58:03-04:00'));
  });

  it('drops onsite postings — the location string is the only remote signal', () => {
    expect(
      normalizeGreenhouseJob({ ...job, location: { name: 'San Francisco, CA' } }, company, SOURCE_ID),
    ).toBeNull();
    expect(
      normalizeGreenhouseJob({ ...job, location: { name: 'Anywhere' } }, company, SOURCE_ID),
    ).not.toBeNull();
  });

  it('drops non-engineering roles and stub descriptions', () => {
    expect(
      normalizeGreenhouseJob(
        { ...job, title: 'Account Executive - Italy', departments: [{ name: 'EMEA - Commercial' }] },
        company,
        SOURCE_ID,
      ),
    ).toBeNull();
    expect(normalizeGreenhouseJob({ ...job, content: '<p>Apply now</p>' }, company, SOURCE_ID)).toBeNull();
  });

  it('falls back to the configured name when the board publishes none', () => {
    const row = normalizeGreenhouseJob({ ...job, company_name: undefined }, company, SOURCE_ID)!;
    expect(row.companyRaw).toBe('GitLab');
  });
});

describe('ashby', () => {
  const company: AtsCompany = { ats: 'ashby', token: 'vanta', name: 'Vanta' };
  const job: AshbyJob = {
    id: 'd5573afa-636c-4219-832f-386f498243bf',
    title: 'Senior Software Engineer, Developer Experience',
    department: 'Engineering',
    team: 'Platform',
    employmentType: 'FullTime',
    location: 'Remote - Canada',
    workplaceType: 'Remote',
    isRemote: true,
    isListed: true,
    publishedAt: '2026-07-14T17:58:07.662+00:00',
    jobUrl: 'https://jobs.ashbyhq.com/Vanta/d5573afa',
    descriptionHtml: `<p>${BODY}</p>`,
    compensation: {
      compensationTierSummary: '$224K – $263K • Offers Equity • Also eligible for a 401(k) plan',
    },
  };

  it('maps a remote engineering post with its compensation range', () => {
    const row = normalizeAshbyJob(job, company, SOURCE_ID)!;
    expect(row).toMatchObject({
      externalId: 'ashby:vanta:d5573afa-636c-4219-832f-386f498243bf',
      title: 'Senior Software Engineer, Developer Experience',
      companyRaw: 'Vanta',
      workFormat: 'remote',
      employmentType: 'full_time',
      salaryMin: 224000,
      salaryMax: 263000,
      salaryCurrency: 'USD',
      location: 'Remote - Canada',
    });
  });

  it('trusts workplaceType over isRemote', () => {
    // Boards set isRemote on hybrid roles: OpenAI reports 475 "remote"
    // postings of which 446 are workplaceType Hybrid.
    const hybrid = { ...job, workplaceType: 'Hybrid', isRemote: true, location: 'San Francisco' };
    expect(normalizeAshbyJob(hybrid, company, SOURCE_ID)).toBeNull();
  });

  it('falls back to the location when workplaceType is absent', () => {
    const noType = { ...job, workplaceType: undefined, isRemote: false, location: 'Remote' };
    expect(normalizeAshbyJob(noType, company, SOURCE_ID)).not.toBeNull();
    expect(
      normalizeAshbyJob({ ...noType, location: 'New York City' }, company, SOURCE_ID),
    ).toBeNull();
  });

  it('skips unlisted postings and non-engineering departments', () => {
    expect(normalizeAshbyJob({ ...job, isListed: false }, company, SOURCE_ID)).toBeNull();
    expect(
      normalizeAshbyJob(
        { ...job, title: 'Account Executive', department: 'Sales', team: 'Revenue' },
        company,
        SOURCE_ID,
      ),
    ).toBeNull();
  });

  it('leaves the salary empty when the board publishes no range', () => {
    const row = normalizeAshbyJob({ ...job, compensation: {} }, company, SOURCE_ID)!;
    expect(row.salaryMin).toBeNull();
    expect(row.salaryCurrency).toBeNull();
  });

  it('maps employment types', () => {
    expect(mapAshbyEmployment('FullTime')).toBe('full_time');
    expect(mapAshbyEmployment('PartTime')).toBe('part_time');
    expect(mapAshbyEmployment('Contract')).toBe('freelance');
    expect(mapAshbyEmployment('Intern')).toBeNull();
  });
});

describe('lever', () => {
  const company: AtsCompany = { ats: 'lever', token: 'veeva', name: 'Veeva Systems' };
  const job: LeverJob = {
    id: 'abc-123',
    text: 'Senior Software Engineer',
    hostedUrl: 'https://jobs.lever.co/veeva/abc-123',
    workplaceType: 'remote',
    country: 'PT',
    createdAt: 1784569799619,
    description: `<div>${BODY}</div>`,
    categories: {
      team: 'Engineering',
      department: 'R&D',
      location: 'Portugal - Lisbon',
      commitment: 'Permanent',
    },
  };

  it('maps a remote engineering post', () => {
    const row = normalizeLeverJob(job, company, SOURCE_ID)!;
    expect(row).toMatchObject({
      externalId: 'lever:veeva:abc-123',
      url: 'https://jobs.lever.co/veeva/abc-123',
      title: 'Senior Software Engineer',
      companyRaw: 'Veeva Systems',
      workFormat: 'remote',
      employmentType: 'full_time',
      location: 'Portugal - Lisbon',
    });
    expect(row.publishedAt).toEqual(new Date(1784569799619));
  });

  it('drops onsite and hybrid postings', () => {
    expect(normalizeLeverJob({ ...job, workplaceType: 'onsite' }, company, SOURCE_ID)).toBeNull();
    expect(normalizeLeverJob({ ...job, workplaceType: 'hybrid' }, company, SOURCE_ID)).toBeNull();
  });

  it('maps commitments, including the ones Lever words differently', () => {
    expect(mapLeverEmployment('Permanent')).toBe('full_time');
    expect(mapLeverEmployment('Full-time')).toBe('full_time');
    expect(mapLeverEmployment('Short Term')).toBe('freelance');
    expect(mapLeverEmployment(undefined)).toBeNull();
  });

  it('falls back to the country when no location category is set', () => {
    const row = normalizeLeverJob(
      { ...job, categories: { team: 'Engineering', commitment: 'Permanent' } },
      company,
      SOURCE_ID,
    )!;
    expect(row.location).toBe('PT');
  });
});

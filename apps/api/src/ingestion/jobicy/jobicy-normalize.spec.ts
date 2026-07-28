import {
  isJobicyJobItem,
  mapJobicyEmployment,
  normalizeJobicyItem,
  type JobicyItem,
} from './jobicy-normalize';

const SOURCE_ID = '00000000-0000-0000-0000-000000000006';

const item: JobicyItem = {
  id: 144256,
  url: 'https://jobicy.com/jobs/144256-senior-react-engineer',
  jobSlug: '144256-senior-react-engineer',
  jobTitle: 'Senior React Engineer',
  companyName: 'Acme Inc',
  jobIndustry: ['Software Engineering'],
  jobType: ['Freelance'],
  jobGeo: 'USA',
  jobLevel: 'Senior',
  jobExcerpt: `Short excerpt. ${'The role covers our design system and the checkout flow. '.repeat(4)}`,
  jobDescription:
    '<p>Build &amp; ship <strong>great</strong> UI&hellip;</p>' +
    `<p>${'You will own the React component library end to end. '.repeat(5)}</p>`,
  pubDate: '2026-07-21T11:30:12+00:00',
};

describe('jobicy normalize', () => {
  it('accepts items with an id and title', () => {
    expect(isJobicyJobItem(item)).toBe(true);
    expect(isJobicyJobItem({ id: 1 })).toBe(false);
    expect(isJobicyJobItem({ jobTitle: 'x' })).toBe(false);
    expect(isJobicyJobItem({ ...item, jobDescription: '<p>See site</p>', jobExcerpt: '' })).toBe(
      false,
    );
  });

  it('maps a job item to the vacancy shape', () => {
    const row = normalizeJobicyItem(item, SOURCE_ID);
    expect(row).toMatchObject({
      sourceId: SOURCE_ID,
      externalId: '144256',
      url: 'https://jobicy.com/jobs/144256-senior-react-engineer',
      title: 'Senior React Engineer',
      companyRaw: 'Acme Inc',
      companyNormalized: 'acme',
      workFormat: 'remote',
      employmentType: 'freelance',
      salaryMin: null,
      salaryCurrency: null,
      location: 'USA',
    });
    expect(row.publishedAt).toEqual(new Date('2026-07-21T11:30:12+00:00'));
  });

  it('prefers the full description and strips HTML/entities', () => {
    const { description } = normalizeJobicyItem(item, SOURCE_ID);
    expect(description).toContain('Build & ship great UI…');
    expect(description).toContain('React component library');
  });

  it('falls back to the excerpt when no full description', () => {
    const row = normalizeJobicyItem({ ...item, jobDescription: undefined }, SOURCE_ID);
    expect(row.description).toContain('Short excerpt.');
  });

  describe('mapJobicyEmployment', () => {
    it('maps the label families', () => {
      expect(mapJobicyEmployment(['Full-Time'])).toBe('full_time');
      expect(mapJobicyEmployment(['Part-Time'])).toBe('part_time');
      expect(mapJobicyEmployment(['Contract'])).toBe('freelance');
      expect(mapJobicyEmployment(['Freelance'])).toBe('freelance');
      expect(mapJobicyEmployment(['Internship'])).toBeNull();
      expect(mapJobicyEmployment(undefined)).toBeNull();
    });
  });
});

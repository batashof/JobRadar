import {
  isRemotiveJobItem,
  normalizeRemotiveItem,
  parseRemotiveSalary,
  type RemotiveItem,
} from './remotive-normalize';

const SOURCE_ID = '00000000-0000-0000-0000-000000000005';

const item: RemotiveItem = {
  id: 2091069,
  url: 'https://remotive.com/remote-jobs/software-dev/senior-react-2091069',
  title: 'Senior React Developer',
  company_name: 'Acme Inc',
  category: 'Software Development',
  tags: ['react', 'typescript'],
  job_type: 'contract',
  publication_date: '2026-07-16T13:28:02',
  candidate_required_location: 'Worldwide',
  salary: '$150k - $230k',
  description:
    '<p>Build &amp; ship <strong>great</strong> UI</p>' +
    `<p>${'You will lead the front-end guild and mentor two mid-level engineers. '.repeat(4)}</p>`,
};

describe('remotive normalize', () => {
  it('keeps only tech-category job items', () => {
    expect(isRemotiveJobItem(item)).toBe(true);
    expect(isRemotiveJobItem({ ...item, category: 'Medical' })).toBe(false);
    expect(isRemotiveJobItem({ ...item, title: '' })).toBe(false);
    expect(isRemotiveJobItem({ ...item, description: '<p>Apply on our site</p>' })).toBe(false);
  });

  it('maps a job item to the vacancy shape', () => {
    const row = normalizeRemotiveItem(item, SOURCE_ID);
    expect(row).toMatchObject({
      sourceId: SOURCE_ID,
      externalId: '2091069',
      url: 'https://remotive.com/remote-jobs/software-dev/senior-react-2091069',
      title: 'Senior React Developer',
      companyRaw: 'Acme Inc',
      companyNormalized: 'acme',
      workFormat: 'remote',
      // contract folds into the freelance enum value.
      employmentType: 'freelance',
      salaryMin: 150000,
      salaryMax: 230000,
      salaryCurrency: 'USD',
      location: 'Worldwide',
    });
    expect(row.publishedAt).toEqual(new Date('2026-07-16T13:28:02'));
  });

  it('strips HTML and decodes basic entities in the description', () => {
    expect(normalizeRemotiveItem(item, SOURCE_ID).description).toContain('Build & ship great UI');
  });

  it('handles sparse items and unknown company', () => {
    const row = normalizeRemotiveItem(
      { id: 5, title: 'Dev', category: 'Devops' },
      SOURCE_ID,
    );
    expect(row.companyRaw).toBe('Unknown');
    expect(row.employmentType).toBeNull();
    expect(row.salaryMin).toBeNull();
    expect(row.salaryCurrency).toBeNull();
  });

  describe('parseRemotiveSalary', () => {
    it('parses annual "k" ranges', () => {
      expect(parseRemotiveSalary('$150k - $230k')).toEqual({
        min: 150000,
        max: 230000,
        currency: 'USD',
      });
    });

    it('parses a single annual figure with no max', () => {
      expect(parseRemotiveSalary('$36k')).toEqual({ min: 36000, max: null, currency: 'USD' });
    });

    it('parses comma-grouped figures', () => {
      expect(parseRemotiveSalary('$150,000 - $230,000')).toEqual({
        min: 150000,
        max: 230000,
        currency: 'USD',
      });
    });

    it('ignores hourly rates', () => {
      expect(parseRemotiveSalary('$120 - $170 /hour')).toEqual({
        min: null,
        max: null,
        currency: null,
      });
    });

    it('returns nulls for empty or unparseable strings', () => {
      expect(parseRemotiveSalary('')).toEqual({ min: null, max: null, currency: null });
      expect(parseRemotiveSalary(undefined)).toEqual({ min: null, max: null, currency: null });
      expect(parseRemotiveSalary('Competitive')).toEqual({ min: null, max: null, currency: null });
    });

    it('detects non-USD currencies', () => {
      expect(parseRemotiveSalary('€90k - €120k')).toMatchObject({ currency: 'EUR' });
    });
  });
});

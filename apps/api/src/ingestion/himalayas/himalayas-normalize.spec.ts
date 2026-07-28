import {
  isHimalayasJobItem,
  mapHimalayasEmployment,
  normalizeHimalayasItem,
  parseHimalayasSalary,
  type HimalayasItem,
} from './himalayas-normalize';

const SOURCE_ID = '00000000-0000-0000-0000-000000000008';

const DESCRIPTION = `<p>${'We are hiring a senior backend engineer to own our Go services. '.repeat(6)}</p>`;

const item: HimalayasItem = {
  title: 'Senior Software Engineer',
  companyName: 'Acme Inc.',
  employmentType: 'Full Time',
  minSalary: 165564,
  maxSalary: 188089.2,
  salaryPeriod: 'annual',
  currency: 'USD',
  seniority: ['Senior'],
  locationRestrictions: ['United States', 'Canada'],
  categories: ['Backend-Engineering', 'Platform-Engineering'],
  parentCategories: ['Developer'],
  description: DESCRIPTION,
  pubDate: 1785224423,
  applicationLink: 'https://himalayas.app/companies/acme/jobs/senior-software-engineer',
  guid: 'https://himalayas.app/companies/acme/jobs/senior-software-engineer',
};

describe('himalayas normalize', () => {
  it('keeps tech items identified by parent category', () => {
    expect(isHimalayasJobItem(item)).toBe(true);
    expect(isHimalayasJobItem({ ...item, parentCategories: ['Healthcare'] })).toBe(false);
  });

  it('falls back to the free-form categories when parent categories are absent', () => {
    const withoutParents = { ...item, parentCategories: [] };
    expect(isHimalayasJobItem(withoutParents)).toBe(true);
    expect(
      isHimalayasJobItem({
        ...withoutParents,
        categories: ['Marriage-And-Family-Therapist', 'Clinical-Counselor'],
      }),
    ).toBe(false);
  });

  it('rejects items without a title, link or real description', () => {
    expect(isHimalayasJobItem({ ...item, title: undefined })).toBe(false);
    expect(isHimalayasJobItem({ ...item, guid: undefined, applicationLink: undefined })).toBe(false);
    expect(isHimalayasJobItem({ ...item, description: '<p>Apply now</p>', excerpt: '' })).toBe(
      false,
    );
  });

  it('maps a job item to the vacancy shape', () => {
    const row = normalizeHimalayasItem(item, SOURCE_ID);
    expect(row).toMatchObject({
      sourceId: SOURCE_ID,
      externalId: 'https://himalayas.app/companies/acme/jobs/senior-software-engineer',
      url: 'https://himalayas.app/companies/acme/jobs/senior-software-engineer',
      title: 'Senior Software Engineer',
      companyRaw: 'Acme Inc.',
      workFormat: 'remote',
      employmentType: 'full_time',
      salaryMin: 165564,
      salaryMax: 188089,
      salaryCurrency: 'USD',
      location: 'United States, Canada',
    });
    expect(row.description).toContain('senior backend engineer');
    expect(row.description).not.toContain('<p>');
    expect(row.publishedAt).toEqual(new Date(1785224423 * 1000));
  });

  it('maps employment types, defaulting to null', () => {
    expect(mapHimalayasEmployment('Full Time')).toBe('full_time');
    expect(mapHimalayasEmployment('Part Time')).toBe('part_time');
    expect(mapHimalayasEmployment('Contract')).toBe('freelance');
    expect(mapHimalayasEmployment('Internship')).toBeNull();
    expect(mapHimalayasEmployment(undefined)).toBeNull();
  });

  it('ignores non-annual salaries so the filters stay comparable', () => {
    expect(parseHimalayasSalary({ ...item, salaryPeriod: 'hourly' })).toEqual({
      min: null,
      max: null,
      currency: null,
    });
    expect(
      parseHimalayasSalary({ ...item, minSalary: null, maxSalary: null }).currency,
    ).toBeNull();
  });
});

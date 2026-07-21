import {
  isWorkingNomadsJobItem,
  normalizeWorkingNomadsItem,
  type WorkingNomadsItem,
} from './workingnomads-normalize';

const SOURCE_ID = '00000000-0000-0000-0000-000000000007';

const item: WorkingNomadsItem = {
  url: 'https://www.workingnomads.com/job/go/1742437/',
  title: 'Senior React & Ruby Developer',
  description: '<p>Build &amp; ship <strong>great</strong> UI</p>',
  company_name: 'Lemon.io',
  category_name: 'Development',
  tags: 'react,ruby,aws',
  location: 'Europe, North America',
  pub_date: '2026-07-21T10:25:53-04:00',
};

describe('workingnomads normalize', () => {
  it('keeps only tech-category items', () => {
    expect(isWorkingNomadsJobItem(item)).toBe(true);
    expect(isWorkingNomadsJobItem({ ...item, category_name: 'Marketing' })).toBe(false);
    expect(isWorkingNomadsJobItem({ ...item, url: undefined })).toBe(false);
  });

  it('maps a job item to the vacancy shape', () => {
    const row = normalizeWorkingNomadsItem(item, SOURCE_ID);
    expect(row).toMatchObject({
      sourceId: SOURCE_ID,
      externalId: '1742437',
      url: 'https://www.workingnomads.com/job/go/1742437/',
      title: 'Senior React & Ruby Developer',
      companyRaw: 'Lemon.io',
      companyNormalized: 'lemon io',
      workFormat: 'remote',
      employmentType: null,
      salaryMin: null,
      location: 'Europe, North America',
    });
    expect(row.publishedAt).toEqual(new Date('2026-07-21T10:25:53-04:00'));
  });

  it('strips HTML and decodes basic entities in the description', () => {
    expect(normalizeWorkingNomadsItem(item, SOURCE_ID).description).toBe('Build & ship great UI');
  });

  it('falls back to the URL as external id when no numeric suffix', () => {
    const row = normalizeWorkingNomadsItem(
      { ...item, url: 'https://www.workingnomads.com/job/some-slug' },
      SOURCE_ID,
    );
    expect(row.externalId).toBe('https://www.workingnomads.com/job/some-slug');
  });
});

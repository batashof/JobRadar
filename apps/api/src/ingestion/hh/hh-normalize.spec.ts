import { normalizeHhItem, type HhVacancyItem } from './hh-normalize';

const SOURCE_ID = '00000000-0000-0000-0000-000000000001';

const fullItem: HhVacancyItem = {
  id: '123456',
  name: 'Senior React Developer',
  alternate_url: 'https://hh.ru/vacancy/123456',
  employer: { name: 'ООО «Рога и Копыта»' },
  snippet: {
    requirement: 'Experience with <highlighttext>React</highlighttext> and TypeScript',
    responsibility: 'Build UI',
  },
  schedule: { id: 'remote' },
  employment: { id: 'full' },
  salary: { from: 3000, to: 5000, currency: 'RUR' },
  area: { name: 'Москва' },
  published_at: '2026-07-18T10:00:00+0300',
};

describe('normalizeHhItem', () => {
  it('maps a fully populated item to the vacancy shape', () => {
    const row = normalizeHhItem(fullItem, SOURCE_ID);
    expect(row).toMatchObject({
      sourceId: SOURCE_ID,
      externalId: '123456',
      url: 'https://hh.ru/vacancy/123456',
      title: 'Senior React Developer',
      companyRaw: 'ООО «Рога и Копыта»',
      companyNormalized: 'рога и копыта',
      workFormat: 'remote',
      employmentType: 'full_time',
      salaryMin: 3000,
      salaryMax: 5000,
      salaryCurrency: 'RUB',
      location: 'Москва',
    });
    expect(row.publishedAt).toEqual(new Date('2026-07-18T10:00:00+0300'));
  });

  it('strips hh highlight tags from the description', () => {
    const row = normalizeHhItem(fullItem, SOURCE_ID);
    expect(row.description).toBe('Experience with React and TypeScript\nBuild UI');
  });

  it('tolerates sparse items (normalization contract: missing stays null)', () => {
    const row = normalizeHhItem(
      { id: '7', name: 'Dev', alternate_url: 'https://hh.ru/vacancy/7' },
      SOURCE_ID,
    );
    expect(row).toMatchObject({
      externalId: '7',
      companyRaw: 'Unknown',
      companyNormalized: 'unknown',
      description: '',
      workFormat: null,
      employmentType: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      location: null,
      publishedAt: null,
    });
  });

  it('does not mark non-remote schedules as remote', () => {
    const row = normalizeHhItem({ ...fullItem, schedule: { id: 'fullDay' } }, SOURCE_ID);
    expect(row.workFormat).toBeNull();
  });
});

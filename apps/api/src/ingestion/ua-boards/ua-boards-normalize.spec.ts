import {
  DJINNI_COMPANY,
  normalizeDjinniItem,
  normalizeDouItem,
  splitDouTitle,
} from './ua-boards-normalize';

const body = '<p>We build a corporate internet bank with Angular, TypeScript and RxJS.</p>'.repeat(4);

describe('splitDouTitle', () => {
  it('splits role, company, city and the remote marker', () => {
    expect(
      splitDouTitle('Middle Frontend Developer (Angular) в Raiffeisen Bank, Київ, віддалено'),
    ).toEqual({
      title: 'Middle Frontend Developer (Angular)',
      company: 'Raiffeisen Bank',
      cities: ['Київ'],
      salary: null,
      remote: true,
    });
  });

  it('reads a salary part', () => {
    const parts = splitDouTitle(
      'E-commerce Web Developer (WordPress-Shopify) в Deveit sp. z o.o., $2000–2200, віддалено',
    );
    expect(parts).toMatchObject({ company: 'Deveit sp. z o.o.', salary: '$2000–2200', cities: [] });
  });

  it('keeps a title without a company whole', () => {
    expect(splitDouTitle('Frontend Developer')).toMatchObject({
      title: 'Frontend Developer',
      company: null,
    });
  });
});

describe('normalizeDouItem', () => {
  const item = {
    title: 'Senior React Developer в Acme, Львів, Київ, $4000–5000, віддалено',
    link: 'https://jobs.dou.ua/companies/acme/vacancies/376822/?utm_source=jobsrss',
    guid: 'https://jobs.dou.ua/companies/acme/vacancies/376822/?1792075397',
    pubDate: 'Thu, 15 Oct 2026 17:43:17 +0300',
    description: body,
  };

  it('maps a posting', () => {
    expect(normalizeDouItem(item, 'src')).toMatchObject({
      externalId: 'dou:376822',
      url: 'https://jobs.dou.ua/companies/acme/vacancies/376822/',
      title: 'Senior React Developer',
      companyRaw: 'Acme',
      workFormat: 'remote',
      salaryMin: 4000,
      salaryMax: 5000,
      salaryCurrency: 'USD',
      location: 'Львів, Київ',
      publishedAt: new Date('2026-10-15T14:43:17Z'),
    });
  });

  it('leaves the format unknown without the remote marker', () => {
    const row = normalizeDouItem({ ...item, title: 'QA Engineer в Acme, Київ' }, 'src');
    expect(row?.workFormat).toBeNull();
    expect(row?.salaryMin).toBeNull();
  });

  it('drops stubs and items without an id', () => {
    expect(normalizeDouItem({ ...item, description: '<p>Short.</p>' }, 'src')).toBeNull();
    expect(normalizeDouItem({ ...item, link: 'https://dou.ua/', guid: undefined }, 'src')).toBeNull();
  });
});

describe('normalizeDjinniItem', () => {
  const item = {
    title: 'Front-end Developer',
    link: 'https://djinni.co/jobs/850653-front-end-developer/',
    guid: 'https://djinni.co/jobs/850653-front-end-developer/',
    pubDate: 'Thu, 15 Oct 2026 13:07:28 +0300',
    description: body,
    category: ['JavaScript', ''],
  };

  it('maps a posting with an anonymous company that never deduplicates', () => {
    expect(normalizeDjinniItem(item, 'src')).toMatchObject({
      externalId: 'djinni:850653',
      url: 'https://djinni.co/jobs/850653-front-end-developer/',
      title: 'Front-end Developer',
      companyRaw: DJINNI_COMPANY,
      companyNormalized: 'unknown',
      workFormat: null,
    });
  });

  it('drops stubs', () => {
    expect(normalizeDjinniItem({ ...item, description: 'Apply now' }, 'src')).toBeNull();
  });
});

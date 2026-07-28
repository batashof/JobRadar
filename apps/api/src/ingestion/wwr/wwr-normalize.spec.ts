import { isWwrJobItem, normalizeWwrItem, splitWwrTitle, type WwrRssItem } from './wwr-normalize';

const SOURCE_ID = '00000000-0000-0000-0000-000000000003';

const item: WwrRssItem = {
  title: 'Khibraty: Lead Full-stack Developer (Full-Time Remote Contractor)',
  link: 'https://weworkremotely.com/remote-jobs/khibraty-lead-full-stack-developer',
  guid: 'https://weworkremotely.com/remote-jobs/khibraty-lead-full-stack-developer',
  pubDate: 'Fri, 17 Jul 2026 10:00:00 +0000',
  description:
    '<p><strong>Headquarters:</strong> Amman, Jordan</p><p>Great &amp; remote job</p>' +
    `<p>${'You will own the whole stack, from the Rails API to the React front-end. '.repeat(4)}</p>`,
  region: 'Anywhere in the World',
  category: 'Full-Stack Programming',
  type: 'Full-Time',
};

describe('splitWwrTitle', () => {
  it('splits "Company: Title" on the first colon', () => {
    expect(splitWwrTitle('Acme Inc: Senior Dev: Platform')).toEqual({
      company: 'Acme Inc',
      title: 'Senior Dev: Platform',
    });
  });

  it('falls back to Unknown company when there is no colon', () => {
    expect(splitWwrTitle('Just a title')).toEqual({ company: 'Unknown', title: 'Just a title' });
  });
});

describe('wwr normalize', () => {
  it('detects job items', () => {
    expect(isWwrJobItem(item)).toBe(true);
    expect(isWwrJobItem({ description: 'no title or guid' })).toBe(false);
  });

  it('rejects feed entries without a real posting body', () => {
    expect(isWwrJobItem({ ...item, description: '<p>See our careers page</p>' })).toBe(false);
  });

  it('maps an RSS item to the vacancy shape', () => {
    const row = normalizeWwrItem(item, SOURCE_ID);
    expect(row).toMatchObject({
      sourceId: SOURCE_ID,
      externalId: 'https://weworkremotely.com/remote-jobs/khibraty-lead-full-stack-developer',
      title: 'Lead Full-stack Developer (Full-Time Remote Contractor)',
      companyRaw: 'Khibraty',
      companyNormalized: 'khibraty',
      workFormat: 'remote',
      employmentType: 'full_time',
      location: 'Anywhere in the World',
    });
    expect(row.description).toContain('Headquarters: Amman, Jordan');
    expect(row.description).toContain('Great & remote job');
    expect(row.publishedAt).toEqual(new Date('Fri, 17 Jul 2026 10:00:00 +0000'));
  });

  it('tolerates sparse items', () => {
    const row = normalizeWwrItem({ title: 'Acme: Dev', link: 'https://wwr.com/x' }, SOURCE_ID);
    expect(row.externalId).toBe('https://wwr.com/x');
    expect(row.employmentType).toBeNull();
    expect(row.publishedAt).toBeNull();
    expect(row.location).toBeNull();
  });
});

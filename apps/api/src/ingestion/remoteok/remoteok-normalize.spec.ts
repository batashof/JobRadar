import { isJobItem, normalizeRemoteOkItem, type RemoteOkItem } from './remoteok-normalize';

const SOURCE_ID = '00000000-0000-0000-0000-000000000002';

const item: RemoteOkItem = {
  id: '1135035',
  slug: 'remote-senior-react-dev-1135035',
  date: '2026-07-18T17:27:57+00:00',
  company: 'Acme Inc',
  position: 'Senior React Developer',
  tags: ['react', 'typescript'],
  description: '<p>Build &amp; ship <strong>great</strong> UI</p>',
  location: 'Worldwide',
  salary_min: 90000,
  salary_max: 120000,
  url: 'https://remoteok.com/remote-jobs/remote-senior-react-dev-1135035',
};

describe('remoteok normalize', () => {
  it('filters out the legal-notice element', () => {
    expect(isJobItem({ legal: 'API Terms of Service...' })).toBe(false);
    expect(isJobItem(item)).toBe(true);
  });

  it('maps a job item to the vacancy shape with link-back url', () => {
    const row = normalizeRemoteOkItem(item, SOURCE_ID);
    expect(row).toMatchObject({
      sourceId: SOURCE_ID,
      externalId: '1135035',
      url: 'https://remoteok.com/remote-jobs/remote-senior-react-dev-1135035',
      title: 'Senior React Developer',
      companyRaw: 'Acme Inc',
      companyNormalized: 'acme',
      workFormat: 'remote',
      salaryMin: 90000,
      salaryMax: 120000,
      salaryCurrency: 'USD',
      location: 'Worldwide',
    });
  });

  it('strips HTML and decodes basic entities in the description', () => {
    expect(normalizeRemoteOkItem(item, SOURCE_ID).description).toBe('Build & ship great UI');
  });

  it('handles sparse items and epoch-only dates', () => {
    const row = normalizeRemoteOkItem({ id: 5, position: 'Dev', epoch: 1784395677 }, SOURCE_ID);
    expect(row.companyRaw).toBe('Unknown');
    expect(row.salaryCurrency).toBeNull();
    expect(row.url).toBe('https://remoteok.com/remote-jobs/5');
    expect(row.publishedAt).toEqual(new Date(1784395677 * 1000));
  });
});

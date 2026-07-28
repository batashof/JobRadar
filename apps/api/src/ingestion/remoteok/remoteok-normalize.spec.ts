import { isJobItem, normalizeRemoteOkItem, type RemoteOkItem } from './remoteok-normalize';

const SOURCE_ID = '00000000-0000-0000-0000-000000000002';

/** Every item of their feed carries this footer; nothing else is a vacancy. */
const ANTI_SPAM_FOOTER =
  '<br/><br/>Please mention the word **AMICABILITY** and tag RNzQuMjIwLjQ4LjI5 when applying ' +
  'to show you read the job post completely (#RNzQuMjIwLjQ4LjI5). This is a beta feature to ' +
  'avoid spam applicants. Companies can search these words to find applicants that read this ' +
  "and see they're human.";

const BODY = `<p>Build &amp; ship <strong>great</strong> UI. ${'We work in React and TypeScript across a mature design system. '.repeat(4)}</p>`;

const item: RemoteOkItem = {
  id: '1135035',
  slug: 'remote-senior-react-dev-1135035',
  date: '2026-07-18T17:27:57+00:00',
  company: 'Acme Inc',
  position: 'Senior React Developer',
  tags: ['react', 'typescript'],
  description: BODY + ANTI_SPAM_FOOTER,
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

  it('rejects scraped pages whose body is only boilerplate', () => {
    const cookieNotice =
      'This website uses cookies to enhance usability and provide you with a more personal ' +
      'experience. By using this website, you agree to our use of cookies as explained in our ' +
      'Privacy Policy.';
    expect(
      isJobItem({
        id: '99',
        position: 'From the Office of the Mayor',
        description: cookieNotice + ANTI_SPAM_FOOTER,
      }),
    ).toBe(false);
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

  it('strips HTML, decodes entities and drops the anti-spam footer', () => {
    const { description } = normalizeRemoteOkItem(item, SOURCE_ID);
    expect(description).toContain('Build & ship great UI.');
    expect(description).not.toContain('AMICABILITY');
    expect(description).not.toContain('spam applicants');
  });

  it('handles sparse items and epoch-only dates', () => {
    const row = normalizeRemoteOkItem({ id: 5, position: 'Dev', epoch: 1784395677 }, SOURCE_ID);
    expect(row.companyRaw).toBe('Unknown');
    expect(row.salaryCurrency).toBeNull();
    expect(row.url).toBe('https://remoteok.com/remote-jobs/5');
    expect(row.publishedAt).toEqual(new Date(1784395677 * 1000));
  });
});

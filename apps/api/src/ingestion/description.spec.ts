import {
  cleanDescription,
  hasSubstantialDescription,
  stripHtml,
  MIN_DESCRIPTION_LENGTH,
} from './description';

const long = (text: string): string => text.padEnd(MIN_DESCRIPTION_LENGTH + 50, ' filler words');

describe('stripHtml', () => {
  it('removes tags and decodes named entities', () => {
    expect(stripHtml('<p>Build &amp; ship <strong>great</strong> UI</p>')).toBe(
      'Build & ship great UI',
    );
  });

  it('decodes numeric entities instead of blanking them', () => {
    expect(stripHtml('Doctolib&#39;s team &#x2014; remote')).toBe("Doctolib's team — remote");
  });

  it('handles double-encoded markup', () => {
    expect(stripHtml('&lt;p&gt;We are hiring&lt;/p&gt;')).toBe('We are hiring');
  });

  it('repairs UTF-8-read-as-Latin-1 mojibake', () => {
    expect(stripHtml('SalaryÂ£45k for childrenâ€™s books')).toBe('Salary£45k for children’s books');
  });

  it('leaves genuine non-Latin text alone even when it looks like mojibake', () => {
    expect(stripHtml('<p>Требуется Ã© senior — 300 000 ₽</p>')).toBe(
      'Требуется Ã© senior — 300 000 ₽',
    );
  });
});

describe('cleanDescription', () => {
  it('drops the RemoteOK anti-spam footer', () => {
    const raw =
      'We are looking for a Go engineer.<br/><br/>Please mention the word **AMICABILITY** and ' +
      "tag RNzQuMjIwLjQ4LjI5 when applying to show you read the job post completely " +
      "(#RNzQuMjIwLjQ4LjI5). This is a beta feature to avoid spam applicants. Companies can " +
      "search these words to find applicants that read this and see they're human.";
    expect(cleanDescription(raw)).toBe('We are looking for a Go engineer.');
  });

  it('drops cookie banners scraped into the body', () => {
    const raw =
      'This website uses cookies to enhance usability and provide you with a more personal ' +
      'experience. By using this website, you agree to our use of cookies as explained in our ' +
      'Privacy Policy.<br/><br/>Senior React developer wanted.';
    expect(cleanDescription(raw)).toBe('Senior React developer wanted.');
  });

  it('returns an empty string for a body that is only boilerplate', () => {
    const raw =
      'This website uses cookies to enhance usability and provide you with a more personal ' +
      'experience. By using this website, you agree to our use of cookies as explained in our ' +
      "Privacy Policy.<br/><br/>Please mention the word **STELLARLY** and tag RMzcu when " +
      "applying to show you read the job post completely (#RMzcu). This is a beta feature to " +
      "avoid spam applicants. Companies can search these words to find applicants that read " +
      "this and see they're human.";
    expect(cleanDescription(raw)).toBe('');
  });

  it('treats missing input as an empty description', () => {
    expect(cleanDescription(undefined)).toBe('');
    expect(cleanDescription(null)).toBe('');
  });
});

describe('hasSubstantialDescription', () => {
  it('rejects boilerplate-only and stub bodies', () => {
    expect(hasSubstantialDescription(undefined)).toBe(false);
    expect(hasSubstantialDescription('<p>Apply now</p>')).toBe(false);
    expect(
      hasSubstantialDescription(
        "Please mention the word **ECSTATIC** and tag RMzcu when applying to show you read the " +
          "job post completely (#RMzcu). This is a beta feature to avoid spam applicants. " +
          "Companies can search these words to find applicants that read this and see they're human.",
      ),
    ).toBe(false);
  });

  it('accepts a real posting body', () => {
    expect(hasSubstantialDescription(long('<p>We are hiring a senior backend engineer.'))).toBe(
      true,
    );
  });
});

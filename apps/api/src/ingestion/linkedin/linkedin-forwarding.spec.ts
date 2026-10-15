import {
  ALERTS_TOKEN_LENGTH,
  buildForwardingAddress,
  confirmationText,
  extractAlertsToken,
  generateAlertsToken,
  instructionsText,
  isForwardingConfirmation,
  parseForwardingConfirmation,
  unavailableText,
} from './linkedin-forwarding';

const MAILBOX = 'JobRadar.Alerts@gmail.com';

describe('generateAlertsToken', () => {
  it('makes 12 lowercase base32 characters, different every time', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateAlertsToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) {
      expect(token).toHaveLength(ALERTS_TOKEN_LENGTH);
      expect(token).toMatch(/^[a-z2-7]{12}$/);
    }
  });
});

describe('buildForwardingAddress', () => {
  it('plus-addresses the mailbox, lowercased', () => {
    expect(buildForwardingAddress(MAILBOX, 'abc234defghi')).toBe(
      'jobradar.alerts+abc234defghi@gmail.com',
    );
  });

  it('drops a plus tag the mailbox itself carries', () => {
    expect(buildForwardingAddress('alerts+inbox@example.com', 'tok')).toBe(
      'alerts+tok@example.com',
    );
  });

  it('refuses a malformed mailbox', () => {
    expect(buildForwardingAddress('not-an-address', 'tok')).toBeNull();
    expect(buildForwardingAddress('@example.com', 'tok')).toBeNull();
  });
});

describe('extractAlertsToken', () => {
  it('finds the token in a plus address of the mailbox, case-insensitively', () => {
    expect(
      extractAlertsToken(['someone@else.com', 'JobRadar.Alerts+ABC234DEFGHI@Gmail.com'], MAILBOX),
    ).toBe('abc234defghi');
  });

  it('ignores Gmail dots in the local part', () => {
    expect(extractAlertsToken(['jobradaralerts+tok123@gmail.com'], MAILBOX)).toBe('tok123');
  });

  it('is null for the bare mailbox, other mailboxes and other domains', () => {
    expect(extractAlertsToken(['jobradar.alerts@gmail.com'], MAILBOX)).toBeNull();
    expect(extractAlertsToken(['other+tok@gmail.com'], MAILBOX)).toBeNull();
    expect(extractAlertsToken(['jobradar.alerts+tok@example.com'], MAILBOX)).toBeNull();
    expect(extractAlertsToken([], MAILBOX)).toBeNull();
  });

  it('rejects a token with characters a generated one never has', () => {
    expect(extractAlertsToken(['jobradar.alerts+a-b@gmail.com'], MAILBOX)).toBeNull();
  });

  it('keeps dots significant outside Gmail', () => {
    expect(extractAlertsToken(['a.lerts+tok@example.com'], 'alerts@example.com')).toBeNull();
    expect(extractAlertsToken(['alerts+tok@example.com'], 'alerts@example.com')).toBe('tok');
  });
});

const CONFIRMATION = {
  from: 'forwarding-noreply@google.com',
  subject: '(#123456789) Gmail Forwarding Confirmation - Receive Mail from someone@gmail.com',
  text: [
    'someone@gmail.com has requested to automatically forward mail to your email',
    'address jobradar.alerts+abc234defghi@gmail.com.',
    'Confirmation code: 123456789',
    '',
    'To allow someone@gmail.com to automatically forward mail to your address,',
    'please click the link below to confirm the request:',
    '',
    'https://mail-settings.google.com/mail/vf-%5BANGjdJ8%5D-abc?x=1',
  ].join('\n'),
  html: '',
};

describe('isForwardingConfirmation', () => {
  it('recognises the sender and both subject languages', () => {
    expect(
      isForwardingConfirmation({
        from: 'forwarding-noreply@google.com',
        subject: '',
      }),
    ).toBe(true);
    expect(
      isForwardingConfirmation({
        from: 'x@y.z',
        subject: CONFIRMATION.subject,
      }),
    ).toBe(true);
    expect(
      isForwardingConfirmation({
        from: 'x@y.z',
        subject: '(#1234567) Подтверждение пересылки Gmail',
      }),
    ).toBe(true);
    expect(
      isForwardingConfirmation({
        from: 'jobalerts-noreply@linkedin.com',
        subject: 'Frontend jobs',
      }),
    ).toBe(false);
  });
});

describe('parseForwardingConfirmation', () => {
  it('takes the code from the subject and the google.com vf link from the body', () => {
    expect(parseForwardingConfirmation(CONFIRMATION)).toEqual({
      code: '123456789',
      link: 'https://mail-settings.google.com/mail/vf-%5BANGjdJ8%5D-abc?x=1',
    });
  });

  it('falls back to the code in the body, Russian too', () => {
    expect(
      parseForwardingConfirmation({
        ...CONFIRMATION,
        subject: 'Подтверждение пересылки Gmail',
        text: 'Код подтверждения: 987654321',
      }),
    ).toEqual({ code: '987654321', link: null });
  });

  it('decodes the link from an HTML body and ignores non-Google links', () => {
    const result = parseForwardingConfirmation({
      ...CONFIRMATION,
      text: '',
      html:
        '<a href="https://evil.example.com/vf-1">x</a>' +
        '<a href="https://mail-settings.google.com/mail/vf-abc?a=1&amp;b=2">confirm</a>',
    });
    expect(result?.link).toBe('https://mail-settings.google.com/mail/vf-abc?a=1&b=2');
  });

  it('is null without a code', () => {
    expect(
      parseForwardingConfirmation({
        ...CONFIRMATION,
        subject: 'Gmail Forwarding',
        text: 'hello',
      }),
    ).toBeNull();
  });
});

describe('bot texts', () => {
  it('relays the code with the link, escaped, in the user language', () => {
    const en = confirmationText('en', {
      code: '123456789',
      link: 'https://a.google.com/vf?a=1&b=2',
    });
    expect(en).toContain('<code>123456789</code>');
    expect(en).toContain('href="https://a.google.com/vf?a=1&amp;b=2"');
    expect(en).toContain('Forwarding and POP/IMAP');
    const ru = confirmationText('ru', { code: '123456789', link: null });
    expect(ru).toContain('<code>123456789</code>');
    expect(ru).toContain('Пересылка и POP/IMAP');
    expect(ru).not.toContain('href');
  });

  it('explains the forwarding setup with the address and the recent count', () => {
    const en = instructionsText('en', 'alerts+tok@gmail.com', 7);
    expect(en).toContain('<code>alerts+tok@gmail.com</code>');
    expect(en).toContain('from:jobalerts-noreply@linkedin.com');
    expect(en).toContain('shown only to you');
    expect(en).toContain('last 14 days: 7');
    expect(en).toMatch(/1\. .*\n2\. .*\n3\. .*\n4\. /);
    const ru = instructionsText('ru', 'alerts+tok@gmail.com', 0);
    expect(ru).toContain('видишь только ты');
    expect(ru).toContain('14 дней из твоих оповещений пришло вакансий: 0');
  });

  it('says when the feature is off', () => {
    expect(unavailableText('en')).toContain('unavailable');
    expect(unavailableText('ru')).toContain('недоступна');
  });
});

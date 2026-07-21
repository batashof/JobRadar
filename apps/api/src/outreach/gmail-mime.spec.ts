import { buildMimeMessage, encodeHeader, toBase64Url } from './gmail-mime';

describe('encodeHeader', () => {
  it('passes plain ASCII through', () => {
    expect(encodeHeader('Senior React Developer - application')).toBe(
      'Senior React Developer - application',
    );
  });

  it('encodes non-ASCII subjects as UTF-8 encoded-words', () => {
    const encoded = encodeHeader('Отклик: Senior React');
    expect(encoded).toMatch(/^=\?UTF-8\?B\?.+\?=$/);
    const b64 = encoded.slice('=?UTF-8?B?'.length, -'?='.length);
    expect(Buffer.from(b64, 'base64').toString('utf8')).toBe('Отклик: Senior React');
  });
});

describe('buildMimeMessage', () => {
  const message = buildMimeMessage({
    from: 'me@example.com',
    to: 'hr@acme.dev',
    subject: 'Отклик на вакансию',
    bodyText: 'Здравствуйте!\nПисьмо.',
    attachment: {
      filename: 'my resume (v2).pdf',
      contentType: 'application/pdf',
      content: Buffer.from('%PDF-fake'),
    },
  });

  it('carries headers, sanitized attachment name, and both parts', () => {
    expect(message).toContain('From: me@example.com');
    expect(message).toContain('To: hr@acme.dev');
    expect(message).toContain('Subject: =?UTF-8?B?');
    expect(message).toContain('Content-Type: multipart/mixed; boundary=');
    expect(message).toContain('filename="my_resume__v2_.pdf"');
    expect(message).toContain(Buffer.from('%PDF-fake').toString('base64'));
    // body text is base64-encoded UTF-8
    expect(message).toContain(Buffer.from('Здравствуйте!\nПисьмо.', 'utf8').toString('base64'));
  });

  it('closes the multipart properly', () => {
    expect(message.trimEnd().endsWith('--jobradar-boundary-0000--')).toBe(true);
  });
});

describe('toBase64Url', () => {
  it('produces base64url without padding', () => {
    const encoded = toBase64Url('a?b/c+d');
    expect(encoded).not.toMatch(/[+/=]/);
    expect(Buffer.from(encoded, 'base64url').toString('utf8')).toBe('a?b/c+d');
  });
});

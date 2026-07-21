/** RFC 2822 MIME assembly for the Gmail send API, kept pure for testing. */

/** RFC 2047 encoded-word so non-ASCII subjects survive transport. */
export function encodeHeader(value: string): string {
  // ASCII without leading/trailing spaces can go as-is.
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function chunk76(b64: string): string {
  return b64.replace(/(.{76})/g, '$1\r\n');
}

export interface MimeInput {
  from: string;
  to: string;
  subject: string;
  bodyText: string;
  attachment: { filename: string; contentType: string; content: Buffer };
}

/** Builds a multipart/mixed message: UTF-8 text body + one attachment. */
export function buildMimeMessage(input: MimeInput): string {
  const boundary = 'jobradar-boundary-0000';
  const safeName = input.attachment.filename.replace(/[^\w.-]/g, '_');

  return [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${encodeHeader(input.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    chunk76(Buffer.from(input.bodyText, 'utf8').toString('base64')),
    `--${boundary}`,
    `Content-Type: ${input.attachment.contentType}; name="${safeName}"`,
    `Content-Disposition: attachment; filename="${safeName}"`,
    'Content-Transfer-Encoding: base64',
    '',
    chunk76(input.attachment.content.toString('base64')),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

/** Gmail's `raw` field wants base64url without padding. */
export function toBase64Url(message: string): string {
  return Buffer.from(message, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

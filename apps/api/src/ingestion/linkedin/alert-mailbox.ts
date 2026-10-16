import { ImapFlow } from 'imapflow';
import { type ParsedMail, simpleParser } from 'mailparser';

export interface AlertMessage {
  uid: number;
  date: Date | null;
  /** Lowercased sender address; '' when the message has none. */
  from: string;
  /**
   * Lowercased addresses the message was delivered to, from Delivered-To,
   * X-Original-To, To and Cc — the plus-address token of a forwarded alert
   * lives here (ADR-027).
   */
  recipients: string[];
  subject: string;
  html: string;
  text: string;
}

export interface AlertMailboxOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  /** Folder to search; defaults to the server's "All Mail" (Gmail), else INBOX. */
  mailbox?: string;
  /**
   * Sender addresses to search for (IMAP FROM is a substring match): the alert
   * senders plus Gmail's forwarding-confirmation sender (ADR-027).
   */
  senders: string[];
  since: Date;
  /** Newest-first cap on messages read per run. */
  maxMessages: number;
}

/**
 * Reads the alert emails from the user's own mailbox over IMAP (ADR-021).
 *
 * Opened read-only: fetching a message would otherwise flag it as seen, and
 * this worker has no business changing the state of anyone's inbox. Searching
 * "All Mail" rather than INBOX means a Gmail filter that archives the alerts
 * (or labels them away from the inbox) does not hide them from ingestion.
 */
export async function fetchAlertMessages(options: AlertMailboxOptions): Promise<AlertMessage[]> {
  const client = new ImapFlow({
    host: options.host,
    port: options.port,
    secure: true,
    auth: { user: options.user, pass: options.password },
    logger: false,
  });

  await client.connect();
  try {
    const path =
      options.mailbox ??
      (await client.list()).find((box) => box.specialUse === '\\All')?.path ??
      'INBOX';
    const lock = await client.getMailboxLock(path, { readOnly: true });
    try {
      const uids = new Set<number>();
      for (const from of options.senders) {
        const found = await client.search({ from, since: options.since }, { uid: true });
        for (const uid of found || []) uids.add(uid);
      }
      const newest = [...uids].sort((a, b) => b - a).slice(0, options.maxMessages);
      if (newest.length === 0) return [];

      const messages: AlertMessage[] = [];
      for await (const message of client.fetch(
        newest,
        { source: true, internalDate: true },
        { uid: true },
      )) {
        if (!message.source) continue;
        const parsed = await simpleParser(message.source);
        const internalDate = message.internalDate ? new Date(message.internalDate) : null;
        messages.push({
          uid: message.uid,
          date: parsed.date ?? internalDate,
          from: parsed.from?.value[0]?.address?.toLowerCase() ?? '',
          recipients: collectRecipients(parsed),
          subject: parsed.subject ?? '',
          html: typeof parsed.html === 'string' ? parsed.html : '',
          text: parsed.text ?? '',
        });
      }
      return messages;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
}

const EMAIL = /[^\s<>"',;:()]+@[^\s<>"',;:()]+/g;

/** Every address in a mailparser header value, whatever shape it was parsed into. */
function addressesIn(value: unknown): string[] {
  if (typeof value === 'string') return value.match(EMAIL) ?? [];
  if (Array.isArray(value)) return value.flatMap(addressesIn);
  if (value && typeof value === 'object') {
    const object = value as { value?: unknown; address?: unknown; group?: unknown };
    return [
      ...(typeof object.address === 'string' ? [object.address] : []),
      ...(object.value !== undefined ? addressesIn(object.value) : []),
      ...(object.group !== undefined ? addressesIn(object.group) : []),
    ];
  }
  return [];
}

/**
 * Lowercased, de-duplicated recipient addresses: Delivered-To and
 * X-Original-To first (they name the address the mail actually reached, which
 * a forwarder does not rewrite), then To and Cc.
 */
export function collectRecipients(parsed: Pick<ParsedMail, 'headers' | 'to' | 'cc'>): string[] {
  const all = [
    ...addressesIn(parsed.headers.get('delivered-to')),
    ...addressesIn(parsed.headers.get('x-original-to')),
    ...addressesIn(parsed.to),
    ...addressesIn(parsed.cc),
  ];
  return [...new Set(all.map((address) => address.trim().toLowerCase()).filter(Boolean))];
}

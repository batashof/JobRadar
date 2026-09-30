import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

export interface AlertMessage {
  uid: number;
  date: Date | null;
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
  /** Sender addresses the alert emails come from (IMAP FROM is a substring match). */
  senders: string[];
  since: Date;
  /** Newest-first cap on messages read per run. */
  maxMessages: number;
}

/**
 * Reads the alert emails from the user's own mailbox over IMAP (ADR-020).
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

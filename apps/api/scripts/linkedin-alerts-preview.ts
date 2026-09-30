/**
 * Shows what the LinkedIn job-alert worker (ADR-020) would ingest, without
 * writing anything. The email layout is LinkedIn's to change, so this is how a
 * parser assumption gets checked against real mail before it is trusted.
 *
 *   pnpm --filter @jobradar/api linkedin:alerts:preview --file ~/alert.eml
 *     Parses a saved email (Gmail: ⋮ → "Download message").
 *
 *   pnpm --filter @jobradar/api linkedin:alerts:preview [--days 3]
 *     Reads the mailbox with ALERTS_IMAP_USER/ALERTS_IMAP_PASSWORD from the
 *     repo-root .env, exactly as the worker does (read-only).
 */
import { readFile } from 'node:fs/promises';

import { config } from 'dotenv';
import { simpleParser } from 'mailparser';

import { fetchAlertMessages, type AlertMessage } from '../src/ingestion/linkedin/alert-mailbox';
import {
  collectVacancies,
  DEFAULT_ALERT_SENDERS,
} from '../src/ingestion/linkedin/linkedin-alerts.service';

config({ path: '../../.env' });

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function fromFile(path: string): Promise<AlertMessage[]> {
  const parsed = await simpleParser(await readFile(path));
  return [
    {
      uid: 0,
      date: parsed.date ?? null,
      subject: parsed.subject ?? '',
      html: typeof parsed.html === 'string' ? parsed.html : '',
      text: parsed.text ?? '',
    },
  ];
}

async function fromMailbox(days: number): Promise<AlertMessage[]> {
  const user = process.env.ALERTS_IMAP_USER;
  const password = process.env.ALERTS_IMAP_PASSWORD;
  if (!user || !password) throw new Error('ALERTS_IMAP_USER / ALERTS_IMAP_PASSWORD are not set');
  return fetchAlertMessages({
    host: process.env.ALERTS_IMAP_HOST || 'imap.gmail.com',
    port: Number(process.env.ALERTS_IMAP_PORT || 993),
    user,
    password,
    senders: DEFAULT_ALERT_SENDERS,
    since: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
    maxMessages: 50,
  });
}

async function main(): Promise<void> {
  const file = arg('file');
  const messages = file ? await fromFile(file) : await fromMailbox(Number(arg('days') ?? 3));

  console.log(`${messages.length} email(s):`);
  for (const message of messages) console.log(`  ${message.date?.toISOString() ?? '?'}  ${message.subject}`);

  const rows = collectVacancies(messages, 'preview');
  console.log(`\n${rows.length} job(s):`);
  for (const row of rows) {
    console.log(
      [
        `\n• ${row.title}`,
        `  company:  ${row.companyRaw}`,
        `  location: ${row.location ?? '—'} · format: ${row.workFormat ?? '—'}`,
        `  salary:   ${row.salaryMin ?? '—'}–${row.salaryMax ?? '—'} ${row.salaryCurrency ?? ''}`,
        `  url:      ${row.url}`,
      ].join('\n'),
    );
  }
  if (messages.length > 0 && rows.length === 0) {
    console.error('\nEmails were read but no job came out: the parser needs the new layout.');
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

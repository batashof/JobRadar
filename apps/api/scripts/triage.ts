/**
 * Daily triage of the bug and feedback inbox (ADR-036), run by the "Triage"
 * workflow:
 *   1. items the owner marked 🛠 become GitHub issues labelled agent-fix,
 *      which the scheduled fixer takes;
 *   2. issues that were closed close their items (done, or skip when closed
 *      as not planned);
 *   3. with --digest, the open list goes to the owner's Telegram chat when
 *      it holds something the owner has not seen.
 *
 * Inputs:
 *   DATABASE_URL_PROD (+ DATABASE_CA_CERT_PROD)   with --prod
 *   GITHUB_TOKEN + GITHUB_REPOSITORY             steps 1–2 (issues: write)
 *   TELEGRAM_BOT_TOKEN                           step 3
 *
 * Usage: pnpm --filter @jobradar/api triage [--prod] [--digest]
 */
import { appendFileSync } from 'node:fs';
import type { Language } from '@jobradar/shared';
import { config } from 'dotenv';
import { and, eq, isNotNull } from 'drizzle-orm';

import type { InlineKeyboard } from '../src/bot/telegram-api';
import { openScriptDb } from '../src/db/prod-db';
import { reports, telegramAccounts, users } from '../src/db/schema';
import { createIssue, ensureFixLabel, type GithubRepo, issueOutcome } from '../src/triage/github-issues';
import { loadTriage, markDigested } from '../src/triage/reports';
import { FIX_LABEL, issueBody, issueTitle, renderTriage, type ReportKind, type ReportStatus } from '../src/triage/triage-logic';

config({ path: '../../.env' });

const toWire = (keyboard: InlineKeyboard) =>
  keyboard.map((row) => row.map((b) => ({ text: b.text, callback_data: b.callbackData, url: b.url })));

async function main(): Promise<void> {
  const prod = process.argv.includes('--prod');
  const digest = process.argv.includes('--digest');
  const { db, close } = openScriptDb(prod);
  const log: string[] = ['## Triage', ''];
  try {
    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPOSITORY;
    const gh: GithubRepo | null = token && repo ? { token, repo } : null;

    if (!gh) {
      log.push('- GITHUB_TOKEN or GITHUB_REPOSITORY is not set: no issues synced.');
    } else {
      const marked = await db.select().from(reports).where(eq(reports.status, 'fix'));
      if (marked.length > 0) await ensureFixLabel(gh);
      for (const row of marked) {
        const item = {
          ...row,
          kind: row.kind as ReportKind,
          status: row.status as ReportStatus,
          unseen: row.digestedAt === null,
        };
        const number = await createIssue(gh, {
          title: issueTitle(item),
          body: issueBody(item),
          labels: [FIX_LABEL, row.kind === 'error' ? 'bug' : 'feedback'],
        });
        await db.update(reports).set({ status: 'issued', issueNumber: number }).where(eq(reports.id, row.id));
        log.push(`- #${row.id} → issue #${number}`);
      }

      const issued = await db
        .select({ id: reports.id, issueNumber: reports.issueNumber })
        .from(reports)
        .where(and(eq(reports.status, 'issued'), isNotNull(reports.issueNumber)));
      for (const row of issued) {
        const outcome = await issueOutcome(gh, row.issueNumber!);
        if (outcome === 'open') continue;
        await db.update(reports).set({ status: outcome }).where(eq(reports.id, row.id));
        log.push(`- #${row.id}: issue #${row.issueNumber} closed → ${outcome}`);
      }
      log.push(`- Synced: ${marked.length} new issue(s), ${issued.length} open issue(s) checked.`);
    }

    const bot = process.env.TELEGRAM_BOT_TOKEN;
    if (digest && bot) {
      const { items, extras } = await loadTriage(db);
      if (!items.some((item) => item.unseen)) {
        log.push('- Digest: nothing new, not sent.');
      } else {
        const owners = await db
          .select({ chatId: telegramAccounts.chatId, language: users.language })
          .from(users)
          .innerJoin(telegramAccounts, eq(telegramAccounts.userId, users.id))
          .where(and(eq(users.role, 'owner'), isNotNull(telegramAccounts.chatId)));
        let sent = 0;
        for (const owner of owners) {
          const lang: Language = owner.language === 'en' ? 'en' : 'ru';
          const { text, keyboard } = renderTriage(lang, items, extras);
          const response = await fetch(`https://api.telegram.org/bot${bot}/sendMessage`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              chat_id: owner.chatId,
              text,
              parse_mode: 'HTML',
              link_preview_options: { is_disabled: true },
              reply_markup: { inline_keyboard: toWire(keyboard) },
            }),
          });
          if (response.ok) sent += 1;
          else console.warn(`telegram: HTTP ${response.status} ${await response.text().catch(() => '')}`);
        }
        if (sent > 0) await markDigested(db, items.map((item) => item.id));
        log.push(`- Digest: ${items.length} open item(s) sent to ${sent} chat(s).`);
      }
    } else if (digest) {
      log.push('- TELEGRAM_BOT_TOKEN is not set: no digest.');
    }
  } finally {
    await close();
    const report = `${log.join('\n')}\n`;
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
    console.log(report);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

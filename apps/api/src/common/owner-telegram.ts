import type { Language } from '@jobradar/shared';
import { and, eq, isNotNull } from 'drizzle-orm';

import type { Database } from '../db/db.module';
import { telegramAccounts, users } from '../db/schema';

/**
 * Telegram for the maintenance scripts the workflows run (quality audit,
 * triage): they have the bot token but no Nest app, so no `BotService`.
 */

export interface OwnerChat {
  chatId: string;
  language: Language;
}

/** Every owner's linked chat, the same set `BotService.notifyOwners` writes to. */
export async function ownerChats(db: Database): Promise<OwnerChat[]> {
  const rows = await db
    .select({ chatId: telegramAccounts.chatId, language: users.language })
    .from(users)
    .innerJoin(telegramAccounts, eq(telegramAccounts.userId, users.id))
    .where(and(eq(users.role, 'owner'), isNotNull(telegramAccounts.chatId)));
  return rows.flatMap((row) =>
    row.chatId ? [{ chatId: row.chatId, language: row.language === 'en' ? 'en' : 'ru' } as OwnerChat] : [],
  );
}

/**
 * One `sendMessage`. Resolves to null when Telegram took it, otherwise to
 * what went wrong, so the script can say so in its log instead of failing
 * silently. Never throws.
 */
export async function sendTelegramMessage(
  token: string,
  message: Record<string, unknown> & { chat_id: string; text: string },
): Promise<string | null> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ link_preview_options: { is_disabled: true }, ...message }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) return null;
    const body = (await response.json().catch(() => ({}))) as { description?: string };
    return `HTTP ${response.status}${body.description ? `: ${body.description}` : ''}`;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

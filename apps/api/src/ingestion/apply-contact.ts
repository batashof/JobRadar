import type { ApplyContact } from '@jobradar/shared';

/**
 * Extracts a "where to apply" contact from vacancy text (ADR-011).
 *
 * Priority: email → Telegram handle/t.me link → apply URL. Regex-first per the
 * ADR; an LLM fallback can come later. Telegram handles are everywhere in
 * channel posts (self-promo mentions), so a bare @handle counts only when it
 * sits on a line that talks about contacting/applying; t.me links count from
 * anywhere.
 */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;

// Lines like "Контакты: @hr_name", "Писать сюда — @name", "DM @name", "CV to @name"
const CONTACT_LINE_RE =
  /контакт|писать|пишите|пиши |отклик|резюме|связ|телеграм|telegram|hr[:\s@]|dm |contact|apply|cv |send |reach /i;

const TG_HANDLE_RE = /@([A-Za-z0-9_]{5,32})\b/;
const TG_LINK_RE = /(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]{5,32})\b/;
const URL_RE = /https?:\/\/[^\s)>\]"']+/;

// t.me/<reserved> paths that are not usernames.
const TG_RESERVED = new Set(['joinchat', 'share', 'proxy', 'socks', 'addstickers', 'iv']);

export function extractApplyContact(text: string): ApplyContact | null {
  if (!text) return null;

  const email = text.match(EMAIL_RE)?.[0];
  if (email) return { kind: 'email', value: email };

  const lines = text.split('\n');

  for (const line of lines) {
    if (!CONTACT_LINE_RE.test(line)) continue;
    const viaLink = line.match(TG_LINK_RE)?.[1];
    if (viaLink && !TG_RESERVED.has(viaLink.toLowerCase())) {
      return { kind: 'telegram', value: `@${viaLink}` };
    }
    const handle = line.match(TG_HANDLE_RE)?.[1];
    if (handle) return { kind: 'telegram', value: `@${handle}` };
  }

  const tgLink = text.match(TG_LINK_RE)?.[1];
  if (tgLink && !TG_RESERVED.has(tgLink.toLowerCase())) {
    return { kind: 'telegram', value: `@${tgLink}` };
  }

  for (const line of lines) {
    if (!CONTACT_LINE_RE.test(line)) continue;
    const url = line.match(URL_RE)?.[0];
    if (url) return { kind: 'url', value: url.replace(/[.,;:!?]+$/, '') };
  }

  return null;
}

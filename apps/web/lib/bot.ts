import type { TelegramLinkStart, TelegramLinkStatus } from '@jobradar/shared';

import { apiFetch } from './api';

/** Telegram bot channel — one chat link per account, shared by every feature. */

export function getTelegramStatus(): Promise<TelegramLinkStatus> {
  return apiFetch<TelegramLinkStatus>('/bot/telegram');
}

export function startTelegramLink(): Promise<TelegramLinkStart> {
  return apiFetch<TelegramLinkStart>('/bot/telegram/link', { method: 'POST' });
}

export function unlinkTelegram(): Promise<TelegramLinkStatus> {
  return apiFetch<TelegramLinkStatus>('/bot/telegram', { method: 'DELETE' });
}

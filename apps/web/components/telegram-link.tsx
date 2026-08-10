'use client';

import type { TelegramLinkStatus } from '@jobradar/shared';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { getTelegramStatus, startTelegramLink, unlinkTelegram } from '@/lib/bot';
import { updatePlannerSettings } from '@/lib/planner';
import { useI18n } from '@/lib/i18n/context';

/**
 * Telegram connection card. The link is account-wide (planner nudges today,
 * the daily digest next); the checkbox below it is the planner's own opt-in.
 *
 * Linking happens entirely in Telegram: we hand out a one-tap deep link and
 * the user comes back and presses "check" — no code to type, and no polling.
 */
export function TelegramLink({
  initial,
  plannerEnabled,
}: {
  initial: TelegramLinkStatus;
  plannerEnabled: boolean;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState(initial);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(plannerEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch {
      setError(t('telegram.error'));
    } finally {
      setBusy(false);
    }
  };

  const connect = () =>
    run(async () => {
      const started = await startTelegramLink();
      setDeepLink(started.deepLink);
    });

  const refresh = () =>
    run(async () => {
      const next = await getTelegramStatus();
      setStatus(next);
      if (next.linked) setDeepLink(null);
    });

  const disconnect = () =>
    run(async () => {
      setStatus(await unlinkTelegram());
      setDeepLink(null);
    });

  const toggleNudges = (next: boolean) => {
    setEnabled(next);
    void run(async () => {
      const saved = await updatePlannerSettings({ telegramEnabled: next });
      setEnabled(saved.telegramEnabled);
    });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">{t('telegram.title')}</h2>
          {status.linked && <Badge>{t('telegram.connected')}</Badge>}
        </div>
        <p className="text-sm text-[var(--color-muted-foreground)]">{t('telegram.subtitle')}</p>
      </CardHeader>

      <CardContent className="space-y-3">
        {!status.botConfigured ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {t('telegram.notConfigured')}
          </p>
        ) : status.linked ? (
          <>
            <p className="text-sm">
              {status.username
                ? t('telegram.linkedAs', { username: status.username })
                : t('telegram.linkedPlain')}
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enabled}
                disabled={busy}
                onChange={(event) => toggleNudges(event.target.checked)}
              />
              {t('telegram.plannerNudges')}
            </label>
            <Button variant="outline" onClick={disconnect} disabled={busy}>
              {t('telegram.disconnect')}
            </Button>
          </>
        ) : deepLink ? (
          <>
            <p className="text-sm">{t('telegram.openHint')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <a href={deepLink} target="_blank" rel="noopener noreferrer">
                <Button>{t('telegram.open')}</Button>
              </a>
              <Button variant="outline" onClick={refresh} disabled={busy}>
                {t('telegram.check')}
              </Button>
            </div>
            <p className="break-all text-xs text-[var(--color-muted-foreground)]">{deepLink}</p>
          </>
        ) : (
          <Button onClick={connect} disabled={busy}>
            {t('telegram.connect')}
          </Button>
        )}

        {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
      </CardContent>
    </Card>
  );
}

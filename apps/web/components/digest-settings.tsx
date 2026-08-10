'use client';

import {
  DIGEST_MAX_ITEMS_LIMIT,
  DIGEST_MAX_SENDS_PER_DAY,
  type DigestSettings as DigestSettingsValue,
} from '@jobradar/shared';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updateDigestSettings } from '@/lib/digest';
import { useI18n } from '@/lib/i18n/context';

/**
 * When the daily digest goes out, how often, and how strict it is. Each send
 * time is one push; the count of them *is* "how many times a day", so there is
 * no separate frequency control to keep consistent with the schedule.
 */
export function DigestSettings({ initial }: { initial: DigestSettingsValue }) {
  const { t } = useI18n();
  const [settings, setSettings] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async (next: Partial<DigestSettingsValue>) => {
    const optimistic = { ...settings, ...next };
    setSettings(optimistic);
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      setSettings(
        await updateDigestSettings({
          enabled: optimistic.enabled,
          sendTimes: optimistic.sendTimes,
          maxItems: optimistic.maxItems,
          minScore: optimistic.minScore,
        }),
      );
      setSaved(true);
    } catch {
      // Roll back, so the UI never claims a schedule the server did not accept.
      setSettings(settings);
      setError(t('digest.error'));
    } finally {
      setBusy(false);
    }
  };

  const setTime = (index: number, value: string) => {
    const sendTimes = settings.sendTimes.map((time, i) => (i === index ? value : time));
    setSettings({ ...settings, sendTimes });
  };

  const commitTimes = () => {
    // Duplicates are rejected server-side; drop them here so the user sees why.
    const unique = [...new Set(settings.sendTimes)].sort();
    void save({ sendTimes: unique });
  };

  const addTime = () => {
    if (settings.sendTimes.length >= DIGEST_MAX_SENDS_PER_DAY) return;
    const candidate = settings.sendTimes.includes('19:00') ? '13:00' : '19:00';
    void save({ sendTimes: [...settings.sendTimes, candidate].sort() });
  };

  const removeTime = (index: number) => {
    if (settings.sendTimes.length <= 1) return;
    void save({ sendTimes: settings.sendTimes.filter((_, i) => i !== index) });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <h2 className="text-lg font-semibold">{t('digest.title')}</h2>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          {t('digest.subtitle', { timezone: settings.timezone })}
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={busy}
            onChange={(event) => void save({ enabled: event.target.checked })}
          />
          {t('digest.enabled')}
        </label>

        <div className="space-y-2">
          <Label>{t('digest.times', { count: settings.sendTimes.length })}</Label>
          <div className="flex flex-wrap items-center gap-2">
            {settings.sendTimes.map((time, index) => (
              <div key={index} className="flex items-center gap-1">
                <Input
                  type="time"
                  aria-label={t('digest.timeAt', { index: index + 1 })}
                  value={time}
                  disabled={busy}
                  onChange={(event) => setTime(index, event.target.value)}
                  onBlur={commitTimes}
                  className="w-28"
                />
                {settings.sendTimes.length > 1 && (
                  <Button
                    variant="ghost"
                    aria-label={t('digest.removeTime')}
                    disabled={busy}
                    onClick={() => removeTime(index)}
                  >
                    ×
                  </Button>
                )}
              </div>
            ))}
            {settings.sendTimes.length < DIGEST_MAX_SENDS_PER_DAY && (
              <Button variant="outline" onClick={addTime} disabled={busy}>
                {t('digest.addTime')}
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-4">
          <div className="space-y-1">
            <Label htmlFor="digest-max-items">{t('digest.maxItems')}</Label>
            <Input
              id="digest-max-items"
              type="number"
              min={1}
              max={DIGEST_MAX_ITEMS_LIMIT}
              value={settings.maxItems}
              disabled={busy}
              onChange={(event) =>
                setSettings({ ...settings, maxItems: Number(event.target.value) })
              }
              onBlur={() => void save({ maxItems: settings.maxItems })}
              className="w-24"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="digest-min-score">{t('digest.minScore')}</Label>
            <Input
              id="digest-min-score"
              type="number"
              min={0}
              max={100}
              step={5}
              value={settings.minScore}
              disabled={busy}
              onChange={(event) =>
                setSettings({ ...settings, minScore: Number(event.target.value) })
              }
              onBlur={() => void save({ minScore: settings.minScore })}
              className="w-24"
            />
          </div>
        </div>

        <p className="text-xs text-[var(--color-muted-foreground)]">{t('digest.hint')}</p>

        {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
        {saved && !error && (
          <p className="text-sm text-[var(--color-muted-foreground)]">{t('digest.saved')}</p>
        )}
      </CardContent>
    </Card>
  );
}

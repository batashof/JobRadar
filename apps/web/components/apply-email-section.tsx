'use client';

import type { ApplyEmailDraft, GmailStatus, VacancyDetail } from '@jobradar/shared';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/lib/i18n/context';
import {
  draftApplyEmail,
  fetchGmailStatus,
  sendApplyEmail,
  startGmailOauth,
} from '@/lib/outreach';

/**
 * Email application flow (ADR-011): draft (LLM) → user edits recipient,
 * subject and body → explicit "Send via Gmail" confirmation. Nothing is sent
 * without that click.
 */
export function ApplyEmailSection({
  detail,
  coverLetter,
}: {
  detail: VacancyDetail;
  coverLetter: string | null;
}) {
  const { t, lang } = useI18n();
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [draft, setDraft] = useState<ApplyEmailDraft | null>(null);
  const [busy, setBusy] = useState<'draft' | 'send' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchGmailStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        if (!cancelled) setStatus({ configured: false, connected: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleConnect() {
    setError(null);
    try {
      const { url } = await startGmailOauth();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : t('email.startFailed'));
    }
  }

  async function handleDraft() {
    if (!coverLetter) return;
    setBusy('draft');
    setError(null);
    try {
      setDraft(await draftApplyEmail(detail.id, coverLetter));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('email.draftFailed'));
    } finally {
      setBusy(null);
    }
  }

  async function handleSend() {
    if (!draft) return;
    setBusy('send');
    setError(null);
    try {
      const result = await sendApplyEmail(detail.id, {
        recipient: draft.recipient,
        subject: draft.subject,
        body: draft.body,
      });
      setSentAt(result.sentAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('email.sendFailed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4">
        <CardTitle>{t('email.title')}</CardTitle>
        {status && status.configured && status.connected && !draft && !sentAt ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy === 'draft' || !coverLetter}
            onClick={() => void handleDraft()}
          >
            {busy === 'draft' ? t('email.drafting') : t('email.draft')}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <p role="alert" className="text-sm text-[var(--color-destructive)]">
            {error}
          </p>
        ) : null}

        {sentAt ? (
          <p className="text-sm">
            {t('email.sentAt', { date: new Date(sentAt).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-GB') })}
          </p>
        ) : status == null ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">{t('email.checking')}</p>
        ) : !status.configured ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">{t('email.notConfigured')}</p>
        ) : !status.connected ? (
          <div className="space-y-2">
            <p className="text-sm text-[var(--color-muted-foreground)]">{t('email.connectHint')}</p>
            <Button variant="outline" size="sm" onClick={() => void handleConnect()}>
              {t('email.connect')}
            </Button>
          </div>
        ) : !draft ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {coverLetter ? t('email.draftHint') : t('email.needCover')}
          </p>
        ) : (
          <div className="space-y-3">
            <label className="block text-sm">
              <span className="text-[var(--color-muted-foreground)]">{t('email.to')}</span>
              <Input
                value={draft.recipient}
                placeholder={t('email.recipientPlaceholder')}
                onChange={(e) => setDraft({ ...draft, recipient: e.target.value })}
              />
            </label>
            <label className="block text-sm">
              <span className="text-[var(--color-muted-foreground)]">{t('email.subject')}</span>
              <Input
                value={draft.subject}
                onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              />
            </label>
            <label className="block text-sm">
              <span className="text-[var(--color-muted-foreground)]">{t('email.body')}</span>
              <textarea
                className="mt-1 min-h-48 w-full rounded-md border border-[var(--color-border)] bg-transparent p-3 text-sm leading-relaxed"
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              />
            </label>
            <Button disabled={busy === 'send' || !draft.recipient} onClick={() => void handleSend()}>
              {busy === 'send' ? t('email.sending') : t('email.send')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

'use client';

import type { ApplyEmailDraft, GmailStatus, VacancyDetail } from '@jobradar/shared';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
      setError(err instanceof Error ? err.message : 'Failed to start Gmail connection');
    }
  }

  async function handleDraft() {
    if (!coverLetter) return;
    setBusy('draft');
    setError(null);
    try {
      setDraft(await draftApplyEmail(detail.id, coverLetter));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Draft failed');
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
      setError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4">
        <CardTitle>Email application</CardTitle>
        {status && status.configured && status.connected && !draft && !sentAt ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy === 'draft' || !coverLetter}
            onClick={() => void handleDraft()}
          >
            {busy === 'draft' ? 'Drafting…' : 'Draft email'}
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
            ✅ Sent via Gmail on {new Date(sentAt).toLocaleString()} — the application moved to
            “Applied” on your board.
          </p>
        ) : status == null ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">Checking Gmail status…</p>
        ) : !status.configured ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Email apply is not configured on the server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).
          </p>
        ) : !status.connected ? (
          <div className="space-y-2">
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Connect your Gmail account to send applications (resume PDF attached) from your own
              address.
            </p>
            <Button variant="outline" size="sm" onClick={() => void handleConnect()}>
              Connect Gmail
            </Button>
          </div>
        ) : !draft ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {coverLetter
              ? 'Draft the email — subject and body are generated around your cover letter, and nothing is sent until you confirm.'
              : 'Generate a cover letter above first — the email is built around it.'}
          </p>
        ) : (
          <div className="space-y-3">
            <label className="block text-sm">
              <span className="text-[var(--color-muted-foreground)]">To</span>
              <Input
                value={draft.recipient}
                placeholder="hr@company.com"
                onChange={(e) => setDraft({ ...draft, recipient: e.target.value })}
              />
            </label>
            <label className="block text-sm">
              <span className="text-[var(--color-muted-foreground)]">Subject</span>
              <Input
                value={draft.subject}
                onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              />
            </label>
            <label className="block text-sm">
              <span className="text-[var(--color-muted-foreground)]">Body (resume PDF attached)</span>
              <textarea
                className="mt-1 min-h-48 w-full rounded-md border border-[var(--color-border)] bg-transparent p-3 text-sm leading-relaxed"
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              />
            </label>
            <Button disabled={busy === 'send' || !draft.recipient} onClick={() => void handleSend()}>
              {busy === 'send' ? 'Sending…' : 'Send via Gmail'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

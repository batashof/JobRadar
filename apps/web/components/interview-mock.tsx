'use client';

import {
  INTERVIEW_SENIORITIES,
  type InterviewSeniority,
  type InterviewSessionDetail,
} from '@jobradar/shared';
import Link from 'next/link';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScoreGauge } from '@/components/ui/score-gauge';
import { useI18n } from '@/lib/i18n/context';
import type { TFunction } from '@/lib/i18n/dictionaries';
import { finishSession, replyToSession, startSession } from '@/lib/interview';

function errText(err: unknown, t: TFunction): string {
  return err instanceof Error ? err.message : t('common.somethingWrong');
}

export function InterviewMock({ initialSession }: { initialSession: InterviewSessionDetail | null }) {
  const { t } = useI18n();
  const [session, setSession] = useState<InterviewSessionDetail | null>(initialSession);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('mock.title')}</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">{t('mock.subtitle')}</p>
        </div>
        <Link
          href="/app/interview"
          className="shrink-0 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        >
          {t('mock.prepLink')}
        </Link>
      </header>

      {session ? (
        <SessionView session={session} onSession={setSession} onReset={() => setSession(null)} />
      ) : (
        <StartForm onStarted={setSession} />
      )}
    </div>
  );
}

function StartForm({ onStarted }: { onStarted: (s: InterviewSessionDetail) => void }) {
  const { t } = useI18n();
  const [targetRole, setTargetRole] = useState('');
  const [seniority, setSeniority] = useState<InterviewSeniority | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
    setBusy(true);
    setError(null);
    try {
      const s = await startSession({
        targetRole: targetRole.trim() || undefined,
        targetSeniority: seniority || undefined,
      });
      onStarted(s);
    } catch (err) {
      setError(errText(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('mock.startTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-[var(--color-muted-foreground)]">{t('mock.startHint')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-[var(--color-muted-foreground)]">{t('interview.targetRole')}</span>
            <Input
              value={targetRole}
              placeholder={t('interview.targetRolePlaceholder')}
              onChange={(e) => setTargetRole(e.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-[var(--color-muted-foreground)]">{t('interview.seniority')}</span>
            <select
              aria-label={t('interview.seniority')}
              className="flex h-9 w-full rounded-md border border-[var(--color-input)] bg-transparent px-3 text-sm"
              value={seniority}
              onChange={(e) => setSeniority(e.target.value as InterviewSeniority | '')}
            >
              <option value="">{t('interview.any')}</option>
              {INTERVIEW_SENIORITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-[var(--color-destructive)]">
            {error}
          </p>
        ) : null}
        <Button disabled={busy} onClick={() => void handleStart()}>
          {busy ? t('mock.starting') : t('mock.start')}
        </Button>
      </CardContent>
    </Card>
  );
}

function SessionView({
  session,
  onSession,
  onReset,
}: {
  session: InterviewSessionDetail;
  onSession: (s: InterviewSessionDetail) => void;
  onReset: () => void;
}) {
  const { t } = useI18n();
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState<'reply' | 'finish' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = session.status === 'in_progress';

  async function handleSend() {
    if (!answer.trim()) return;
    setBusy('reply');
    setError(null);
    try {
      const updated = await replyToSession(session.id, answer.trim());
      onSession(updated);
      setAnswer('');
    } catch (err) {
      setError(errText(err, t));
    } finally {
      setBusy(null);
    }
  }

  async function handleFinish() {
    setBusy('finish');
    setError(null);
    try {
      onSession(await finishSession(session.id));
    } catch (err) {
      setError(errText(err, t));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-[var(--color-muted-foreground)]">
        <span>
          {session.targetRole ?? t('mock.generalInterview')}
          {session.targetSeniority ? ` · ${session.targetSeniority}` : ''} ·{' '}
          {active ? t('mock.inProgress') : t('mock.completed')}
        </span>
      </div>

      <ul className="space-y-3" data-testid="transcript">
        {session.transcript.map((turn, i) => (
          <li
            key={i}
            className={turn.role === 'candidate' ? 'flex justify-end' : 'flex justify-start'}
          >
            <div
              className={
                turn.role === 'candidate'
                  ? 'max-w-[80%] whitespace-pre-wrap rounded-lg bg-[var(--color-primary)] px-3 py-2 text-sm text-[var(--color-primary-foreground)]'
                  : 'max-w-[80%] whitespace-pre-wrap rounded-lg bg-[var(--color-muted)] px-3 py-2 text-sm'
              }
            >
              <span className="mb-0.5 block text-xs opacity-70">
                {turn.role === 'candidate' ? t('mock.you') : t('mock.interviewer')}
              </span>
              {turn.content}
            </div>
          </li>
        ))}
      </ul>

      {error ? (
        <p role="alert" className="text-sm text-[var(--color-destructive)]">
          {error}
        </p>
      ) : null}

      {active ? (
        <div className="space-y-2">
          <textarea
            aria-label={t('mock.answerAria')}
            className="min-h-24 w-full rounded-md border border-[var(--color-input)] bg-transparent p-2 text-sm"
            placeholder={t('mock.answerPlaceholder')}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button disabled={busy !== null || !answer.trim()} onClick={() => void handleSend()}>
              {busy === 'reply' ? t('mock.sending') : t('mock.sendAnswer')}
            </Button>
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() => void handleFinish()}
            >
              {busy === 'finish' ? t('mock.ending') : t('mock.finish')}
            </Button>
          </div>
        </div>
      ) : null}

      {session.feedback ? (
        <Card data-testid="feedback">
          <CardHeader className="flex flex-row items-center gap-3">
            <ScoreGauge value={session.feedback.score} size={56} />
            <div>
              <CardTitle className="text-base">{t('mock.feedback')}</CardTitle>
              <p className="text-sm text-[var(--color-muted-foreground)]">
                {session.feedback.summary}
              </p>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {session.feedback.strengths.length ? (
              <div>
                <p className="font-medium">{t('mock.strengths')}</p>
                <ul className="list-inside list-disc text-[var(--color-muted-foreground)]">
                  {session.feedback.strengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {session.feedback.gaps.length ? (
              <div>
                <p className="font-medium">{t('mock.gaps')}</p>
                <ul className="list-inside list-disc text-[var(--color-muted-foreground)]">
                  {session.feedback.gaps.map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {session.feedback.recommendation ? (
              <p>
                <span className="font-medium">{t('mock.recommendation')}</span>
                {session.feedback.recommendation}
              </p>
            ) : null}
            <Button variant="outline" size="sm" onClick={onReset}>
              {t('mock.newInterview')}
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

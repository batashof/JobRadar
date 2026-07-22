'use client';

import type { VacancyDetail } from '@jobradar/shared';
import { useState } from 'react';

import { ApplyEmailSection } from '@/components/apply-email-section';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScoreGauge } from '@/components/ui/score-gauge';
import { publishedText, salaryText } from '@/components/vacancy-card';
import { useI18n } from '@/lib/i18n/context';
import { sourceLabel } from '@/lib/labels';
import { generateBrief, generateCoverLetter, matchResume } from '@/lib/vacancies';

function contactHref(detail: VacancyDetail): string | null {
  const contact = detail.applyContact;
  if (!contact) return null;
  if (contact.kind === 'email') return `mailto:${contact.value}`;
  if (contact.kind === 'telegram') return `https://t.me/${contact.value.replace(/^@/, '')}`;
  return contact.value;
}

const CONTACT_KIND_LABELS: Record<string, string> = {
  email: 'Email',
  telegram: 'Telegram',
  url: 'Link',
};

export function VacancyDetailView({ detail }: { detail: VacancyDetail }) {
  const { t, lang } = useI18n();
  const salary = salaryText(detail, t);
  const published = publishedText(detail.publishedAt, lang);
  const href = contactHref(detail);

  const [brief, setBrief] = useState<string | null>(detail.summary);
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);

  const [letter, setLetter] = useState<string | null>(null);
  const [letterBusy, setLetterBusy] = useState(false);
  const [letterError, setLetterError] = useState<string | null>(null);

  const [match, setMatch] = useState<{ score: number; explanation: string } | null>(
    detail.resumeScore != null
      ? { score: detail.resumeScore, explanation: detail.resumeExplanation ?? '' }
      : null,
  );
  const [matchBusy, setMatchBusy] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);

  async function handleBrief(force: boolean) {
    setBriefBusy(true);
    setBriefError(null);
    try {
      const res = await generateBrief(detail.id, force);
      setBrief(res.summary);
    } catch (err) {
      setBriefError(err instanceof Error ? err.message : t('detail.briefFailed'));
    } finally {
      setBriefBusy(false);
    }
  }

  async function handleMatch() {
    setMatchBusy(true);
    setMatchError(null);
    try {
      const res = await matchResume(detail.id);
      setMatch({ score: res.score, explanation: res.explanation });
    } catch (err) {
      setMatchError(err instanceof Error ? err.message : t('detail.fitFailed'));
    } finally {
      setMatchBusy(false);
    }
  }

  async function handleCoverLetter() {
    setLetterBusy(true);
    setLetterError(null);
    try {
      const res = await generateCoverLetter(detail.id);
      setLetter(res.coverLetter);
    } catch (err) {
      setLetterError(err instanceof Error ? err.message : t('detail.briefFailed'));
    } finally {
      setLetterBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold">{detail.title}</h1>
          <Badge variant="muted">{sourceLabel(detail.source)}</Badge>
        </div>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          {detail.company}
          {detail.location ? ` · ${detail.location}` : ''}
          {published ? ` · ${published}` : ''}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {detail.workFormat ? (
            <Badge variant="outline">{t(`workFormat.${detail.workFormat}`)}</Badge>
          ) : null}
          {detail.employmentType ? (
            <Badge variant="default">{t(`employmentType.${detail.employmentType}`)}</Badge>
          ) : null}
          {salary ? <Badge variant="primary">{salary}</Badge> : null}
          <a
            href={detail.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-[var(--color-muted-foreground)] underline hover:text-[var(--color-foreground)]"
          >
            {t('detail.openOriginal')}
          </a>
        </div>
      </div>

      {detail.applyContact ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-3 text-sm">
            <span className="text-[var(--color-muted-foreground)]">
              {t('detail.applyContact', {
                kind: CONTACT_KIND_LABELS[detail.applyContact.kind] ?? t('detail.contact'),
              })}
            </span>
            {href ? (
              <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                {detail.applyContact.value}
              </a>
            ) : (
              <span className="font-medium">{detail.applyContact.value}</span>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4">
          <CardTitle>{t('detail.fitTitle')}</CardTitle>
          <Button variant="outline" size="sm" disabled={matchBusy} onClick={() => void handleMatch()}>
            {matchBusy ? t('detail.fitScoring') : match ? t('detail.fitRecalc') : t('detail.fitScore')}
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {matchError ? (
            <p role="alert" className="text-sm text-[var(--color-destructive)]">
              {matchError}
            </p>
          ) : null}
          {match ? (
            <div className="flex items-center gap-4">
              <ScoreGauge value={match.score} />
              {match.explanation ? (
                <p className="flex-1 text-sm leading-relaxed">{match.explanation}</p>
              ) : null}
            </div>
          ) : !matchError ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">{t('detail.fitPlaceholder')}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4">
          <CardTitle>{t('detail.briefTitle')}</CardTitle>
          <Button
            variant="outline"
            size="sm"
            disabled={briefBusy}
            onClick={() => void handleBrief(Boolean(brief))}
          >
            {briefBusy
              ? t('detail.briefGenerating')
              : brief
                ? t('detail.briefRegen')
                : t('detail.briefGen')}
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {briefError ? (
            <p role="alert" className="text-sm text-[var(--color-destructive)]">
              {briefError}
            </p>
          ) : null}
          {brief ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{brief}</p>
          ) : !briefError ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">{t('detail.briefPlaceholder')}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4">
          <CardTitle>{t('detail.coverTitle')}</CardTitle>
          <Button variant="outline" size="sm" disabled={letterBusy} onClick={() => void handleCoverLetter()}>
            {letterBusy
              ? t('detail.coverGenerating')
              : letter
                ? t('detail.coverRegen')
                : t('detail.coverGen')}
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {letterError ? (
            <p role="alert" className="text-sm text-[var(--color-destructive)]">
              {letterError}
            </p>
          ) : null}
          {letter != null ? (
            <textarea
              aria-label={t('detail.coverAria')}
              className="min-h-56 w-full rounded-md border border-[var(--color-border)] bg-transparent p-3 text-sm leading-relaxed"
              value={letter}
              onChange={(e) => setLetter(e.target.value)}
            />
          ) : !letterError ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">{t('detail.coverPlaceholder')}</p>
          ) : null}
        </CardContent>
      </Card>

      <ApplyEmailSection detail={detail} coverLetter={letter} />

      <Card>
        <CardHeader>
          <CardTitle>{t('detail.descriptionTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{detail.description}</p>
        </CardContent>
      </Card>
    </div>
  );
}

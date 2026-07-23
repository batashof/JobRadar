'use client';

import {
  type AddPlanBlockInput,
  type DayPlanDetail,
  isRotting,
  type PlanBlockCategory,
  type PlanBlockItem,
  type PlanCandidate,
  type PlanCandidatesResponse,
  type PlannerSettings,
  type PlannerTodayResponse,
  type PlanSkipReason,
  PLAN_BLOCK_CATEGORIES,
  plannedMinutes,
} from '@jobradar/shared';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useI18n } from '@/lib/i18n/context';
import type { TranslationKey } from '@/lib/i18n/dictionaries';
import {
  acceptDayPlan,
  addBlock,
  createDayPlan,
  dropBlock,
  getCandidates,
  reorderBlocks,
  setPlanIntent,
  updateBlock,
  updatePlannerSettings,
} from '@/lib/planner';

/** Reasons the user can pick when dropping a block; `unreported` is system-only. */
const DROP_REASONS: PlanSkipReason[] = [
  'changed_priority',
  'no_time',
  'no_energy',
  'blocked',
  'avoided',
];

/** Blocks that are done with, one way or another. */
function isTerminal(block: PlanBlockItem): boolean {
  return block.status === 'dropped' || block.status === 'done';
}

/**
 * The day surface (ADR-015, increment 1): a queue of timeboxes assembled by
 * hand from SQL-collected candidates, with the morning "accept" ritual. The
 * focus timer, evening close-out and Telegram nudges land in later increments.
 */
export function DayPlanner({
  initial,
  initialCandidates,
}: {
  initial: PlannerTodayResponse;
  initialCandidates: PlanCandidatesResponse;
}) {
  const { t } = useI18n();
  const [plan, setPlan] = useState<DayPlanDetail | null>(initial.plan);
  const [settings, setSettings] = useState<PlannerSettings>(initial.settings);
  const [candidates, setCandidates] = useState<PlanCandidatesResponse>(initialCandidates);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [droppingId, setDroppingId] = useState<string | null>(null);
  const [dropReason, setDropReason] = useState<PlanSkipReason>('changed_priority');

  const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const blocks = plan?.blocks ?? [];
  const liveBlocks = blocks.filter((block) => block.status !== 'dropped');
  const planned = plannedMinutes(blocks);
  const overCapacity = planned > settings.capacityMinutes;

  /** Every mutation returns the whole plan, so the queue can never drift. */
  async function run(action: () => Promise<DayPlanDetail | null>) {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      if (next) setPlan(next);
      setCandidates(await getCandidates());
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  }

  function addFromCandidate(candidate: PlanCandidate) {
    const input: AddPlanBlockInput = {
      title: candidate.title,
      details: candidate.reason,
      category: candidate.category,
      sourceKind: candidate.sourceKind,
      sourceRef: candidate.sourceRef ?? undefined,
      estimateMinutes: candidate.estimateMinutes,
      carriedFromBlockId: candidate.carriedFromBlockId,
    };
    void run(() => addBlock(input));
  }

  function move(index: number, delta: number) {
    if (!plan) return;
    const ids = blocks.map((block) => block.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    const reordered = [...ids];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved!);
    void run(() => reorderBlocks(plan.id, reordered));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('day.title')}</h1>
        <p className="text-[var(--color-muted-foreground)]">{t('day.subtitle')}</p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-[var(--color-destructive)]">
          {error}
        </p>
      )}

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{initial.today}</h2>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={overCapacity ? 'destructive' : 'muted'}>
                {t('day.capacity', { planned, capacity: settings.capacityMinutes })}
              </Badge>
              <Badge variant="muted">
                {t('day.factor', { factor: settings.estimationFactor.toFixed(2) })}
              </Badge>
              {candidates.debt.count > 0 && (
                <Badge variant="destructive">
                  {t('day.debt', {
                    count: candidates.debt.count,
                    minutes: candidates.debt.minutes,
                  })}
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {deviceTimezone && deviceTimezone !== settings.timezone && (
            <p className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
              {t('day.timezoneMismatch', { device: deviceTimezone, current: settings.timezone })}
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    setSettings(await updatePlannerSettings({ timezone: deviceTimezone }));
                  })();
                }}
              >
                {t('day.useDeviceTimezone')}
              </Button>
            </p>
          )}

          {!plan ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-[var(--color-muted-foreground)]">{t('day.unplanned')}</p>
              <Button disabled={busy} onClick={() => void run(() => createDayPlan())}>
                {t('day.start')}
              </Button>
            </div>
          ) : (
            <>
              <div>
                <Label htmlFor="day-intent">{t('day.intentLabel')}</Label>
                <Input
                  id="day-intent"
                  defaultValue={plan.intent ?? ''}
                  placeholder={t('day.intentPlaceholder')}
                  onBlur={(event) => {
                    const value = event.target.value.trim();
                    if (value !== (plan.intent ?? '')) {
                      void run(() => setPlanIntent(plan.id, value));
                    }
                  }}
                />
              </div>
              {plan.status === 'draft' ? (
                <div className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--color-border)] p-3">
                  <p className="text-sm">{t('day.acceptPrompt')}</p>
                  <Button
                    disabled={busy || liveBlocks.length === 0}
                    onClick={() => void run(() => acceptDayPlan(plan.id))}
                  >
                    {t('day.accept')}
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-[var(--color-muted-foreground)]">{t('day.accepted')}</p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {plan && (
        <Card>
          <CardHeader className="pb-2">
            <h2 className="text-lg font-semibold">{t('day.queue')}</h2>
            <p className="text-sm text-[var(--color-muted-foreground)]">{t('day.queueHint')}</p>
          </CardHeader>
          <CardContent>
            {blocks.length === 0 ? (
              <p className="py-3 text-sm text-[var(--color-muted-foreground)]">{t('day.empty')}</p>
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {blocks.map((block, index) => (
                  <li key={block.id} className="space-y-2 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p
                          className={`truncate text-sm font-medium ${
                            block.status === 'dropped' ? 'line-through opacity-60' : ''
                          }`}
                        >
                          {index + 1}. {block.title}
                        </p>
                        {block.details && (
                          <p className="truncate text-xs text-[var(--color-muted-foreground)]">
                            {block.details}
                          </p>
                        )}
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <Badge variant="muted">
                            {t(`planCategory.${block.category}` as TranslationKey)}
                          </Badge>
                          {block.carryCount > 0 && (
                            <Badge variant={isRotting(block) ? 'destructive' : 'muted'}>
                              {t('day.carried', { count: block.carryCount })}
                            </Badge>
                          )}
                          {block.status === 'dropped' && block.skipReason && (
                            <Badge variant="muted">
                              {t(`skipReason.${block.skipReason}` as TranslationKey)}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <label className="sr-only" htmlFor={`estimate-${block.id}`}>
                          {t('day.estimate')}
                        </label>
                        <Input
                          id={`estimate-${block.id}`}
                          type="number"
                          min={5}
                          max={480}
                          step={5}
                          className="w-20"
                          disabled={isTerminal(block)}
                          defaultValue={block.estimateMinutes}
                          onBlur={(event) => {
                            const minutes = Number(event.target.value);
                            if (Number.isFinite(minutes) && minutes !== block.estimateMinutes) {
                              void run(() =>
                                updateBlock(block.id, { estimateMinutes: minutes }),
                              );
                            }
                          }}
                        />
                        <span className="text-xs text-[var(--color-muted-foreground)]">
                          {t('day.corrected', { minutes: block.correctedEstimateMinutes })}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t('day.moveUp')}
                          disabled={busy || index === 0}
                          onClick={() => move(index, -1)}
                        >
                          ↑
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t('day.moveDown')}
                          disabled={busy || index === blocks.length - 1}
                          onClick={() => move(index, 1)}
                        >
                          ↓
                        </Button>
                        {!isTerminal(block) && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => setDroppingId(block.id)}
                          >
                            {t('day.drop')}
                          </Button>
                        )}
                      </div>
                    </div>

                    {droppingId === block.id && (
                      <div className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--color-border)] p-2">
                        <label className="text-sm" htmlFor={`reason-${block.id}`}>
                          {t('day.dropReason')}
                        </label>
                        <select
                          id={`reason-${block.id}`}
                          className="rounded-md border border-[var(--color-border)] bg-transparent px-2 py-1 text-sm"
                          value={dropReason}
                          onChange={(event) =>
                            setDropReason(event.target.value as PlanSkipReason)
                          }
                        >
                          {DROP_REASONS.map((reason) => (
                            <option key={reason} value={reason}>
                              {t(`skipReason.${reason}` as TranslationKey)}
                            </option>
                          ))}
                        </select>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            setDroppingId(null);
                            void run(() => dropBlock(block.id, { reason: dropReason }));
                          }}
                        >
                          {t('day.confirmDrop')}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setDroppingId(null)}>
                          {t('common.cancel')}
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <h2 className="text-lg font-semibold">{t('day.candidates')}</h2>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {t('day.candidatesHint')}
          </p>
        </CardHeader>
        <CardContent>
          {candidates.candidates.length === 0 ? (
            <p className="py-3 text-sm text-[var(--color-muted-foreground)]">
              {t('day.candidatesEmpty')}
            </p>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {candidates.candidates.map((candidate) => (
                <li
                  key={candidate.key}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{candidate.title}</p>
                    <p className="truncate text-xs text-[var(--color-muted-foreground)]">
                      {candidate.reason}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={candidate.sourceKind === 'debt' ? 'destructive' : 'muted'}>
                      {t(`planSource.${candidate.sourceKind}` as TranslationKey)}
                    </Badge>
                    <span className="text-xs text-[var(--color-muted-foreground)]">
                      {t('day.minutes', { minutes: candidate.estimateMinutes })}
                    </span>
                    <Button size="sm" disabled={busy} onClick={() => addFromCandidate(candidate)}>
                      {t('day.add')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ManualBlockForm
        busy={busy}
        defaultMinutes={settings.defaultBlockMinutes}
        onSubmit={(input) => void run(() => addBlock(input))}
      />
    </div>
  );
}

function ManualBlockForm({
  busy,
  defaultMinutes,
  onSubmit,
}: {
  busy: boolean;
  defaultMinutes: number;
  onSubmit: (input: AddPlanBlockInput) => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<PlanBlockCategory>('other');
  const [minutes, setMinutes] = useState(defaultMinutes);

  return (
    <Card>
      <CardHeader className="pb-2">
        <h2 className="text-lg font-semibold">{t('day.addManual')}</h2>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = title.trim();
            if (!trimmed) return;
            onSubmit({ title: trimmed, category, estimateMinutes: minutes });
            setTitle('');
          }}
        >
          <div className="min-w-[16rem] flex-1">
            <Label htmlFor="block-title">{t('day.blockTitle')}</Label>
            <Input
              id="block-title"
              value={title}
              placeholder={t('day.blockTitlePlaceholder')}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="block-category">{t('day.category')}</Label>
            <select
              id="block-category"
              className="block rounded-md border border-[var(--color-border)] bg-transparent px-2 py-2 text-sm"
              value={category}
              onChange={(event) => setCategory(event.target.value as PlanBlockCategory)}
            >
              {PLAN_BLOCK_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {t(`planCategory.${value}` as TranslationKey)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="block-minutes">{t('day.estimate')}</Label>
            <Input
              id="block-minutes"
              type="number"
              min={5}
              max={480}
              step={5}
              className="w-24"
              value={minutes}
              onChange={(event) => setMinutes(Number(event.target.value))}
            />
          </div>
          <Button type="submit" disabled={busy || title.trim().length === 0}>
            {t('day.add')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

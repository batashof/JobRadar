'use client';

import {
  INTERVIEW_DIFFICULTIES,
  INTERVIEW_QUESTION_KINDS,
  INTERVIEW_SENIORITIES,
  type InterviewAnswerReview,
  type InterviewDifficulty,
  type InterviewPlanDetail,
  type InterviewPlanTopic,
  type InterviewQuestionItem,
  type InterviewQuestionKind,
  type InterviewSeniority,
  type InterviewTopicStatus,
} from '@jobradar/shared';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScoreGauge } from '@/components/ui/score-gauge';
import {
  generateInterviewPlan,
  generateQuestions,
  listQuestions,
  reviewAnswer,
  revealModelAnswer,
  updateTopicProgress,
} from '@/lib/interview';

const STATUS_LABEL: Record<InterviewTopicStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
};

const KIND_LABEL: Record<InterviewQuestionKind, string> = {
  theory: 'Theory',
  behavioral: 'Behavioural',
  coding: 'Live-coding',
};

function errText(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong';
}

export function InterviewWorkspace({ initialPlan }: { initialPlan: InterviewPlanDetail | null }) {
  const [plan, setPlan] = useState<InterviewPlanDetail | null>(initialPlan);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Interview prep</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            A resume-driven study plan, generated questions, and live-coding practice reviewed by
            the assistant.
          </p>
        </div>
        <Link
          href="/app/interview/mock"
          className="shrink-0 text-sm font-medium text-[var(--color-primary)] hover:underline"
        >
          Mock interview →
        </Link>
      </header>

      {plan ? (
        <PlanView plan={plan} onPlan={setPlan} />
      ) : (
        <PlanForm heading="Generate your prep plan" onPlan={setPlan} />
      )}
    </div>
  );
}

function PlanForm({
  heading,
  onPlan,
}: {
  heading: string;
  onPlan: (plan: InterviewPlanDetail) => void;
}) {
  const [targetRole, setTargetRole] = useState('');
  const [seniority, setSeniority] = useState<InterviewSeniority | ''>('');
  const [focus, setFocus] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setBusy(true);
    setError(null);
    try {
      const focusList = focus
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean);
      const plan = await generateInterviewPlan({
        targetRole: targetRole.trim() || undefined,
        targetSeniority: seniority || undefined,
        focus: focusList.length ? focusList : undefined,
      });
      onPlan(plan);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{heading}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-[var(--color-muted-foreground)]">
          The plan is built from your active resume. Optionally aim it at a role, level, and focus
          areas.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span className="text-[var(--color-muted-foreground)]">Target role</span>
            <Input
              value={targetRole}
              placeholder="e.g. Senior Frontend"
              onChange={(e) => setTargetRole(e.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-[var(--color-muted-foreground)]">Seniority</span>
            <select
              aria-label="Seniority"
              className="flex h-9 w-full rounded-md border border-[var(--color-input)] bg-transparent px-3 text-sm"
              value={seniority}
              onChange={(e) => setSeniority(e.target.value as InterviewSeniority | '')}
            >
              <option value="">Any</option>
              {INTERVIEW_SENIORITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-[var(--color-muted-foreground)]">Focus (comma-separated)</span>
            <Input
              value={focus}
              placeholder="React, System design"
              onChange={(e) => setFocus(e.target.value)}
            />
          </label>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-[var(--color-destructive)]">
            {error}
          </p>
        ) : null}
        <Button disabled={busy} onClick={() => void handleGenerate()}>
          {busy ? 'Generating…' : 'Generate plan'}
        </Button>
      </CardContent>
    </Card>
  );
}

function PlanView({
  plan,
  onPlan,
}: {
  plan: InterviewPlanDetail;
  onPlan: (plan: InterviewPlanDetail) => void;
}) {
  const [activeTopic, setActiveTopic] = useState<InterviewPlanTopic | null>(null);
  const [regenerate, setRegenerate] = useState(false);

  const progressByKey = useMemo(
    () => new Map(plan.progress.map((p) => [p.topicKey, p.status])),
    [plan.progress],
  );

  const totalTopics = plan.structure.sections.reduce((n, s) => n + s.topics.length, 0);
  const doneTopics = plan.progress.filter((p) => p.status === 'done').length;

  function setStatus(topicKey: string, status: InterviewTopicStatus) {
    void (async () => {
      const item = await updateTopicProgress(plan.id, { topicKey, status });
      const progress = plan.progress.some((p) => p.topicKey === topicKey)
        ? plan.progress.map((p) => (p.topicKey === topicKey ? item : p))
        : [...plan.progress, item];
      onPlan({ ...plan, progress });
    })();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-[var(--color-muted-foreground)]">
          <span className="font-medium">{plan.targetRole ?? 'Your plan'}</span>
          {plan.targetSeniority ? <span> · {plan.targetSeniority}</span> : null}
          <span> · </span>
          <span>{`${doneTopics}/${totalTopics} topics done`}</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => setRegenerate((v) => !v)}>
          {regenerate ? 'Cancel' : 'Regenerate plan'}
        </Button>
      </div>

      {regenerate ? <PlanForm heading="Regenerate plan" onPlan={onPlan} /> : null}

      <div className="space-y-5">
        {plan.structure.sections.map((section) => (
          <Card key={section.title}>
            <CardHeader>
              <CardTitle className="text-base">{section.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {section.topics.map((topic) => {
                const status = progressByKey.get(topic.key) ?? 'todo';
                return (
                  <div
                    key={topic.key}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--color-border)] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <button
                        className="text-left text-sm font-medium hover:underline"
                        onClick={() => setActiveTopic(topic)}
                      >
                        {topic.title}
                      </button>
                      {topic.why ? (
                        <p className="text-xs text-[var(--color-muted-foreground)]">{topic.why}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {status === 'done' ? <Badge variant="primary">Done</Badge> : null}
                      <select
                        aria-label={`Progress: ${topic.title}`}
                        className="h-8 rounded-md border border-[var(--color-input)] bg-transparent px-2 text-xs"
                        value={status}
                        onChange={(e) => setStatus(topic.key, e.target.value as InterviewTopicStatus)}
                      >
                        {(Object.keys(STATUS_LABEL) as InterviewTopicStatus[]).map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABEL[s]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>

      {activeTopic ? (
        <TopicDrill
          key={activeTopic.key}
          planId={plan.id}
          topic={activeTopic}
          onClose={() => setActiveTopic(null)}
        />
      ) : null}
    </div>
  );
}

function TopicDrill({
  planId,
  topic,
  onClose,
}: {
  planId: string;
  topic: InterviewPlanTopic;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<InterviewQuestionKind>('theory');
  const [difficulty, setDifficulty] = useState<InterviewDifficulty>('middle');
  const [questions, setQuestions] = useState<InterviewQuestionItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lazy-load any previously generated questions for this topic on mount. The
  // component is remounted per topic (keyed on topic.key), so this runs once.
  useEffect(() => {
    let live = true;
    listQuestions({ topic: topic.title, planId })
      .then((qs) => live && setQuestions(qs))
      .catch(() => live && setQuestions([]));
    return () => {
      live = false;
    };
  }, [planId, topic.title]);

  async function handleGenerate() {
    setBusy(true);
    setError(null);
    try {
      const created = await generateQuestions({
        topic: topic.title,
        kind,
        difficulty,
        planId,
      });
      setQuestions((prev) => [...created, ...(prev ?? [])]);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-testid="topic-drill">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{topic.title}</CardTitle>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-xs">
            <span className="block text-[var(--color-muted-foreground)]">Type</span>
            <select
              aria-label="Question type"
              className="h-9 rounded-md border border-[var(--color-input)] bg-transparent px-2 text-sm"
              value={kind}
              onChange={(e) => setKind(e.target.value as InterviewQuestionKind)}
            >
              {INTERVIEW_QUESTION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span className="block text-[var(--color-muted-foreground)]">Difficulty</span>
            <select
              aria-label="Difficulty"
              className="h-9 rounded-md border border-[var(--color-input)] bg-transparent px-2 text-sm"
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as InterviewDifficulty)}
            >
              {INTERVIEW_DIFFICULTIES.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <Button disabled={busy} onClick={() => void handleGenerate()}>
            {busy ? 'Generating…' : 'Generate questions'}
          </Button>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-[var(--color-destructive)]">
            {error}
          </p>
        ) : null}

        {questions && questions.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            No questions yet — generate some to start practising.
          </p>
        ) : null}

        <ul className="space-y-3">
          {(questions ?? []).map((q) => (
            <li key={q.id}>
              <QuestionCard question={q} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function QuestionCard({ question }: { question: InterviewQuestionItem }) {
  const [modelAnswer, setModelAnswer] = useState<string | null>(question.modelAnswer);
  const [showAnswer, setShowAnswer] = useState(false);
  const [answer, setAnswer] = useState('');
  const [review, setReview] = useState<InterviewAnswerReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleReveal() {
    if (modelAnswer) {
      setShowAnswer((v) => !v);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await revealModelAnswer(question.id);
      setModelAnswer(res.modelAnswer);
      setShowAnswer(true);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleReview() {
    setBusy(true);
    setError(null);
    try {
      setReview(await reviewAnswer(question.id, answer));
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-[var(--color-border)] p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="whitespace-pre-wrap text-sm">{question.prompt}</p>
        <Badge variant="muted">{KIND_LABEL[question.kind]}</Badge>
      </div>

      {question.kind === 'coding' ? (
        <div className="space-y-2">
          <textarea
            aria-label="Your solution"
            className="min-h-28 w-full rounded-md border border-[var(--color-input)] bg-transparent p-2 font-mono text-xs"
            placeholder="Write your solution here — it is reviewed, not executed."
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={busy || answer.trim().length === 0}
            onClick={() => void handleReview()}
          >
            {busy ? 'Reviewing…' : 'Review my solution'}
          </Button>
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void handleReveal()}>
          {showAnswer ? 'Hide model answer' : modelAnswer ? 'Show model answer' : 'Reveal answer'}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-[var(--color-destructive)]">
          {error}
        </p>
      ) : null}

      {showAnswer && modelAnswer ? (
        <div className="rounded-md bg-[var(--color-muted)] p-3">
          <p className="whitespace-pre-wrap text-sm">{modelAnswer}</p>
        </div>
      ) : null}

      {review ? (
        <div className="flex gap-3 rounded-md border border-[var(--color-border)] p-3">
          <ScoreGauge value={review.score} size={56} />
          <div className="space-y-1 text-sm">
            {review.review.verdict ? <p className="font-medium">{review.review.verdict}</p> : null}
            {review.review.correctness ? (
              <p>
                <span className="text-[var(--color-muted-foreground)]">Correctness: </span>
                {review.review.correctness}
              </p>
            ) : null}
            {review.review.complexity ? (
              <p>
                <span className="text-[var(--color-muted-foreground)]">Complexity: </span>
                {review.review.complexity}
              </p>
            ) : null}
            {review.review.style ? (
              <p>
                <span className="text-[var(--color-muted-foreground)]">Style: </span>
                {review.review.style}
              </p>
            ) : null}
            {review.review.suggestions.length ? (
              <ul className="list-inside list-disc text-[var(--color-muted-foreground)]">
                {review.review.suggestions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

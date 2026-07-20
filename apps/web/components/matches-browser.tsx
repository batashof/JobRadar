'use client';

import type { MatchFeed, MatchProfileOption } from '@jobradar/shared';
import { useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { VacancyCard } from '@/components/vacancy-card';
import { ApiError } from '@/lib/api';
import { createApplication } from '@/lib/applications';
import { fetchMatches } from '@/lib/matches';

function scoreText(score: number): string {
  return `${Math.round(score * 100)}% match`;
}

export function MatchesBrowser({
  initial,
  profiles,
  trackedIds,
}: {
  initial: MatchFeed;
  profiles: MatchProfileOption[];
  trackedIds: string[];
}) {
  const [tracked, setTracked] = useState<Set<string>>(() => new Set(trackedIds));
  const [saving, setSaving] = useState<Set<string>>(() => new Set());
  const [profileId, setProfileId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [feed, setFeed] = useState<MatchFeed>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Skip the very first fetch: `initial` already holds the unfiltered page 1.
  // A ref (not state) so flipping it doesn't itself re-trigger the effect.
  const firstRun = useRef(true);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchMatches(profileId, page)
      .then((result) => {
        if (!cancelled) setFeed(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to load matches');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profileId, page]);

  function selectProfile(id: string | null) {
    setProfileId(id);
    setPage(1);
  }

  function handleSave(id: string) {
    setSaving((prev) => new Set(prev).add(id));
    createApplication(id)
      .then(() => setTracked((prev) => new Set(prev).add(id)))
      .catch((err: unknown) => {
        // 409 = already on the board: treat as saved rather than an error.
        if (err instanceof ApiError && err.status === 409) {
          setTracked((prev) => new Set(prev).add(id));
        } else {
          setError('Could not save to the board.');
        }
      })
      .finally(() =>
        setSaving((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        }),
      );
  }

  const totalPages = Math.max(1, Math.ceil(feed.total / feed.pageSize));
  const activeProfiles = profiles.filter((p) => p.isActive);
  const totalCount = activeProfiles.reduce((sum, p) => sum + p.count, 0);
  const showProfileName = profileId === null && activeProfiles.length > 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Matches</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Vacancies matched to your search profiles, best score first. Recomputed after every
          ingestion run and profile change.
        </p>
      </div>

      {activeProfiles.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-[var(--color-muted-foreground)]">
            No active search profiles yet. Create one on the Profiles page to start matching.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by profile">
            <Button
              variant={profileId === null ? 'default' : 'outline'}
              size="sm"
              onClick={() => selectProfile(null)}
            >
              All profiles ({totalCount})
            </Button>
            {activeProfiles.map((p) => (
              <Button
                key={p.id}
                variant={profileId === p.id ? 'default' : 'outline'}
                size="sm"
                onClick={() => selectProfile(p.id)}
              >
                {p.name} ({p.count})
              </Button>
            ))}
          </div>

          <div className="flex items-center justify-between text-sm text-[var(--color-muted-foreground)]">
            <span>
              {feed.total} {feed.total === 1 ? 'match' : 'matches'}
              {loading ? ' · loading…' : ''}
            </span>
            <span>
              Page {feed.page} of {totalPages}
            </span>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-[var(--color-destructive)]">
              {error}
            </p>
          ) : null}

          {feed.items.length === 0 && !loading ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-[var(--color-muted-foreground)]">
                No matches yet. They appear as new vacancies are ingested — or widen the profile
                keywords.
              </CardContent>
            </Card>
          ) : (
            <ul className="space-y-4">
              {feed.items.map((m) => (
                <li key={`${m.profileId}:${m.vacancy.id}`}>
                  <VacancyCard
                    v={m.vacancy}
                    tracked={tracked.has(m.vacancy.id)}
                    saving={saving.has(m.vacancy.id)}
                    onSave={handleSave}
                    leadingBadge={
                      <>
                        <Badge variant="primary">{scoreText(m.score)}</Badge>
                        {showProfileName ? <Badge variant="outline">{m.profileName}</Badge> : null}
                      </>
                    }
                  />
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-center gap-4">
            <Button
              variant="outline"
              size="sm"
              disabled={feed.page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <span className="text-sm text-[var(--color-muted-foreground)]">
              {feed.page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={feed.page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

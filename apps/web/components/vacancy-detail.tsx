'use client';

import type { VacancyDetail } from '@jobradar/shared';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { publishedText, salaryText } from '@/components/vacancy-card';
import { EMPLOYMENT_TYPE_LABELS, sourceLabel, WORK_FORMAT_LABELS } from '@/lib/labels';

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
  const salary = salaryText(detail);
  const published = publishedText(detail.publishedAt);
  const href = contactHref(detail);

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
            <Badge variant="outline">{WORK_FORMAT_LABELS[detail.workFormat]}</Badge>
          ) : null}
          {detail.employmentType ? (
            <Badge variant="default">{EMPLOYMENT_TYPE_LABELS[detail.employmentType]}</Badge>
          ) : null}
          {salary ? <Badge variant="primary">{salary}</Badge> : null}
          <a
            href={detail.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-[var(--color-muted-foreground)] underline hover:text-[var(--color-foreground)]"
          >
            Open original ↗
          </a>
        </div>
      </div>

      {detail.applyContact ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-3 text-sm">
            <span className="text-[var(--color-muted-foreground)]">
              Apply contact ({CONTACT_KIND_LABELS[detail.applyContact.kind] ?? 'Contact'}):
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
        <CardHeader>
          <CardTitle>Description</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{detail.description}</p>
        </CardContent>
      </Card>
    </div>
  );
}

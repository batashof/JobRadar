import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

import { upsertVacancies } from './vacancy-upsert';

function captureUpsert() {
  const conflicts: { set: Record<string, unknown> }[] = [];
  const db = {
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: (config: { set: Record<string, unknown> }) => {
          conflicts.push(config);
          return Promise.resolve();
        },
      }),
    }),
  };
  return { db: db as never, conflicts };
}

const row = {
  sourceId: 's-1',
  externalId: 'e-1',
  url: 'https://example.com/1',
  title: 'Senior React Developer',
  companyRaw: 'Acme',
  companyNormalized: 'acme',
  description: 'React, TypeScript',
};

const toText = (value: unknown) => new PgDialect().sqlToQuery(value as SQL).sql;

describe('upsertVacancies — content_changed_at', () => {
  it('bumps the change stamp only when the matched content differs', async () => {
    const { db, conflicts } = captureUpsert();
    await upsertVacancies(db, [row]);

    const text = toText(conflicts[0]?.set.contentChangedAt);
    expect(text).toMatch(/is distinct from/);
    expect(text).toMatch(/then now\(\)/);
    // Otherwise the stored stamp is kept — a re-seen posting is not a change.
    expect(text).toMatch(/else "vacancies"\."content_changed_at"/);
  });

  it('compares every field profile matching reads, and nothing it does not', async () => {
    const { db, conflicts } = captureUpsert();
    await upsertVacancies(db, [row]);

    const text = toText(conflicts[0]?.set.contentChangedAt);
    for (const column of [
      'title',
      'description',
      'work_format',
      'employment_type',
      'salary_min',
      'salary_max',
      'salary_currency',
    ]) {
      expect(text).toContain(`excluded.${column}`);
    }
    // A moved URL or a re-parsed publish date must not re-trigger matching.
    expect(text).not.toContain('excluded.url');
    expect(text).not.toContain('excluded.published_at');
  });
});

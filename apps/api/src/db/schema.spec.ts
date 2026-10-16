import { getTableConfig } from 'drizzle-orm/pg-core';

import {
  applications,
  applicationStageEnum,
  profileMatches,
  searchProfiles,
  sources,
  users,
  vacancies,
  vacancyRecipients,
  workFormatEnum,
} from './schema';

describe('db schema', () => {
  it('defines all six tables from DATA_MODEL.md', () => {
    const names = [users, searchProfiles, sources, vacancies, applications, profileMatches].map(
      (t) => getTableConfig(t).name,
    );
    expect(names).toEqual([
      'users',
      'search_profiles',
      'sources',
      'vacancies',
      'applications',
      'profile_matches',
    ]);
  });

  it('enforces vacancy identity as unique (source_id, external_id)', () => {
    const { indexes } = getTableConfig(vacancies);
    const unique = indexes.find((i) => i.config.name === 'vacancies_source_external_idx');
    expect(unique?.config.unique).toBe(true);
    expect(unique?.config.columns.map((c) => 'name' in c && c.name)).toEqual([
      'source_id',
      'external_id',
    ]);
  });

  it('has a GIN index on the generated search_vector column', () => {
    const { indexes, columns } = getTableConfig(vacancies);
    const gin = indexes.find((i) => i.config.name === 'vacancies_search_vector_idx');
    expect(gin?.config.method).toBe('gin');

    const searchVector = columns.find((c) => c.name === 'search_vector');
    expect(searchVector?.generated).toBeDefined();
  });

  it('enforces one application per (user, vacancy)', () => {
    const { indexes } = getTableConfig(applications);
    const unique = indexes.find((i) => i.config.name === 'applications_user_vacancy_idx');
    expect(unique?.config.unique).toBe(true);
  });

  it('keys vacancy_recipients on (vacancy, user), both cascading (ADR-027)', () => {
    const { primaryKeys, foreignKeys, name } = getTableConfig(vacancyRecipients);
    expect(name).toBe('vacancy_recipients');
    expect(primaryKeys[0]?.columns.map((c) => c.name)).toEqual(['vacancy_id', 'user_id']);
    expect(foreignKeys.map((fk) => fk.onDelete)).toEqual(['cascade', 'cascade']);
  });

  it('keeps the LinkedIn forwarding token unique per user (ADR-027)', () => {
    const column = getTableConfig(users).columns.find((c) => c.name === 'alerts_token');
    expect(column?.isUnique).toBe(true);
    expect(column?.notNull).toBe(false);
  });

  it('uses a composite primary key on profile_matches', () => {
    const { primaryKeys } = getTableConfig(profileMatches);
    expect(primaryKeys).toHaveLength(1);
    expect(primaryKeys[0]?.columns.map((c) => c.name)).toEqual(['profile_id', 'vacancy_id']);
  });

  it('keeps kanban stages and work formats in sync with the product spec', () => {
    expect(applicationStageEnum.enumValues).toEqual([
      'saved',
      'applied',
      'screening',
      'tech_interview',
      'offer',
      'rejected',
      'withdrawn',
    ]);
    expect(workFormatEnum.enumValues).toEqual(['remote', 'onsite', 'hybrid']);
  });
});

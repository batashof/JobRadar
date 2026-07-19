import { getTableConfig } from 'drizzle-orm/pg-core';

import {
  applications,
  applicationStageEnum,
  profileMatches,
  searchProfiles,
  sources,
  users,
  vacancies,
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

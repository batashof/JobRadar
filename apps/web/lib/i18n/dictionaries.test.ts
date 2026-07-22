import { describe, expect, it } from 'vitest';

import { en, ru, translate } from './dictionaries';

describe('dictionaries', () => {
  it('en and ru cover exactly the same keys', () => {
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
  });

  it('has no empty translations in either language', () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(en[key].length, `en:${key}`).toBeGreaterThan(0);
      expect(ru[key].length, `ru:${key}`).toBeGreaterThan(0);
    }
  });
});

describe('translate', () => {
  it('returns the string for the requested language', () => {
    expect(translate('en', 'detail.briefTitle')).toBe('Vacancy brief');
    expect(translate('ru', 'detail.briefTitle')).toBe('Бриф по вакансии');
    expect(translate('ru', 'detail.fitTitle')).toBe('Насколько подходит мне');
  });

  it('interpolates named placeholders', () => {
    expect(translate('en', 'feed.pageOf', { page: 2, total: 5 })).toBe('Page 2 of 5');
    expect(translate('ru', 'interview.topicsDone', { done: 3, total: 12 })).toBe(
      'Тем пройдено: 3/12',
    );
  });

  it('leaves unknown placeholders untouched', () => {
    expect(translate('en', 'resume.tooLarge')).toContain('{mb}');
  });
});

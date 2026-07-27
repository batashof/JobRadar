import type { AuthUser, SourceOption, VacancyDetail, VacancyFeed, VacancyQuery } from '@jobradar/shared';

import { VacanciesController } from './vacancies.controller';
import type { VacanciesService } from './vacancies.service';

const USER: AuthUser = { id: 'u1', email: 'u@acme.dev', digestEnabled: false, language: 'ru' };

describe('VacanciesController', () => {
  it('delegates the parsed query to the service, scoped to the user', async () => {
    const result: VacancyFeed = { items: [], total: 0, page: 1, pageSize: 20 };
    const feed = jest.fn().mockResolvedValue(result);
    const controller = new VacanciesController({ feed } as unknown as VacanciesService);

    const query: VacancyQuery = {
      q: 'react',
      workFormat: ['remote'],
      employmentType: [],
      sources: ['telegram'],
      resumeFit: false,
      includeHidden: false,
      page: 1,
      pageSize: 20,
    };

    await expect(controller.feed(USER, query)).resolves.toBe(result);
    expect(feed).toHaveBeenCalledWith(USER.id, USER.language, query);
  });

  it('returns the vacancy detail by id, scoped to the user', async () => {
    const detail = {
      id: 'v1',
      title: 'Senior React',
      description: 'full text',
      applyContact: { kind: 'email', value: 'hr@acme.dev' },
      summaryRu: null,
    } as unknown as VacancyDetail;
    const getById = jest.fn().mockResolvedValue(detail);
    const controller = new VacanciesController({ getById } as unknown as VacanciesService);

    await expect(controller.getById(USER, 'v1')).resolves.toBe(detail);
    expect(getById).toHaveBeenCalledWith(USER.id, USER.language, 'v1');
  });

  it('lists source filter options', async () => {
    const options: SourceOption[] = [{ slug: 'remoteok', count: 90 }];
    const listSources = jest.fn().mockResolvedValue(options);
    const controller = new VacanciesController({ listSources } as unknown as VacanciesService);

    await expect(controller.listSources()).resolves.toBe(options);
  });

  it('lists the user hidden vacancy ids', async () => {
    const listHidden = jest.fn().mockResolvedValue(['v1', 'v2']);
    const controller = new VacanciesController({ listHidden } as unknown as VacanciesService);

    await expect(controller.listHidden(USER)).resolves.toEqual(['v1', 'v2']);
    expect(listHidden).toHaveBeenCalledWith(USER.id);
  });

  it('hides and un-hides a vacancy scoped to the user', async () => {
    const hide = jest.fn().mockResolvedValue(undefined);
    const unhide = jest.fn().mockResolvedValue(undefined);
    const controller = new VacanciesController({ hide, unhide } as unknown as VacanciesService);

    await controller.hide(USER, 'v1');
    expect(hide).toHaveBeenCalledWith(USER.id, 'v1');

    await controller.unhide(USER, 'v1');
    expect(unhide).toHaveBeenCalledWith(USER.id, 'v1');
  });
});

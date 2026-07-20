import type { SourceOption, VacancyDetail, VacancyFeed, VacancyQuery } from '@jobradar/shared';

import { VacanciesController } from './vacancies.controller';
import type { VacanciesService } from './vacancies.service';

describe('VacanciesController', () => {
  it('delegates the parsed query to the service', async () => {
    const result: VacancyFeed = { items: [], total: 0, page: 1, pageSize: 20 };
    const feed = jest.fn().mockResolvedValue(result);
    const controller = new VacanciesController({ feed } as unknown as VacanciesService);

    const query: VacancyQuery = {
      q: 'react',
      workFormat: ['remote'],
      employmentType: [],
      sources: ['telegram'],
      page: 1,
      pageSize: 20,
    };

    await expect(controller.feed(query)).resolves.toBe(result);
    expect(feed).toHaveBeenCalledWith(query);
  });

  it('returns the vacancy detail by id', async () => {
    const detail = {
      id: 'v1',
      title: 'Senior React',
      description: 'full text',
      applyContact: { kind: 'email', value: 'hr@acme.dev' },
      summaryRu: null,
    } as unknown as VacancyDetail;
    const getById = jest.fn().mockResolvedValue(detail);
    const controller = new VacanciesController({ getById } as unknown as VacanciesService);

    await expect(controller.getById('v1')).resolves.toBe(detail);
    expect(getById).toHaveBeenCalledWith('v1');
  });

  it('lists source filter options', async () => {
    const options: SourceOption[] = [{ slug: 'remoteok', count: 90 }];
    const listSources = jest.fn().mockResolvedValue(options);
    const controller = new VacanciesController({ listSources } as unknown as VacanciesService);

    await expect(controller.listSources()).resolves.toBe(options);
  });
});

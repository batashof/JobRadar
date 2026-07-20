import type { VacancyFeed, VacancyQuery } from '@jobradar/shared';

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
      page: 1,
      pageSize: 20,
    };

    await expect(controller.feed(query)).resolves.toBe(result);
    expect(feed).toHaveBeenCalledWith(query);
  });
});

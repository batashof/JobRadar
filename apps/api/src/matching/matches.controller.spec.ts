import type { AuthUser, MatchFeed, MatchProfileOption, MatchQuery } from '@jobradar/shared';

import { MatchesController } from './matches.controller';
import type { MatchesService } from './matches.service';
import type { ResumeMatchingService } from './resume-matching.service';

const noResumeMatching = {} as ResumeMatchingService;

const user: AuthUser = { id: 'user-1', email: 'dev@jobradar.local', digestEnabled: true, language: 'ru' };

describe('MatchesController', () => {
  it('delegates the parsed query to the service, scoped to the user', async () => {
    const result: MatchFeed = { items: [], total: 0, page: 1, pageSize: 20 };
    const feed = jest.fn().mockResolvedValue(result);
    const controller = new MatchesController(
      { feed } as unknown as MatchesService,
      noResumeMatching,
    );

    const query: MatchQuery = { profileId: undefined, page: 1, pageSize: 20 };
    await expect(controller.feed(user, query)).resolves.toBe(result);
    expect(feed).toHaveBeenCalledWith(user.id, query);
  });

  it('lists the user profiles as filter options', async () => {
    const options: MatchProfileOption[] = [
      { id: 'p1', name: 'Senior React remote', isActive: true, count: 12 },
    ];
    const listProfileOptions = jest.fn().mockResolvedValue(options);
    const controller = new MatchesController(
      {
        listProfileOptions,
      } as unknown as MatchesService,
      noResumeMatching,
    );

    await expect(controller.listProfileOptions(user)).resolves.toBe(options);
    expect(listProfileOptions).toHaveBeenCalledWith(user.id);
  });

  it('runs on-demand resume scoring for the caller', async () => {
    const scorePending = jest.fn().mockResolvedValue({ scored: 3, remaining: 7 });
    const controller = new MatchesController(
      {} as unknown as MatchesService,
      { scorePending } as unknown as ResumeMatchingService,
    );

    await expect(controller.scoreResume(user)).resolves.toEqual({ scored: 3, remaining: 7 });
    expect(scorePending).toHaveBeenCalledWith(undefined, user.id);
  });
});

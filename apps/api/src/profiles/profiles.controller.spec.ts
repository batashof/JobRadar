import type { AuthUser } from '@jobradar/shared';

import { ProfilesController } from './profiles.controller';
import type { ProfilesService } from './profiles.service';

const user: AuthUser = { id: 'user-1', email: 'a@b.com', digestEnabled: true };

describe('ProfilesController', () => {
  it('list scopes to the current user', async () => {
    const list = jest.fn().mockResolvedValue([{ id: 'p1' }]);
    const controller = new ProfilesController({ list } as unknown as ProfilesService);

    await expect(controller.list(user)).resolves.toEqual([{ id: 'p1' }]);
    expect(list).toHaveBeenCalledWith('user-1');
  });

  it('create forwards the user id and validated body', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'p2' });
    const controller = new ProfilesController({ create } as unknown as ProfilesService);
    const body = {
      name: 'Senior React',
      keywords: ['react'],
      stack: [],
      workFormat: ['remote' as const],
      employmentType: [],
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      isActive: true,
    };

    await controller.create(user, body);
    expect(create).toHaveBeenCalledWith('user-1', body);
  });

  it('update forwards user id, profile id and body', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'p3' });
    const controller = new ProfilesController({ update } as unknown as ProfilesService);

    await controller.update(user, 'p3', { name: 'Renamed' });
    expect(update).toHaveBeenCalledWith('user-1', 'p3', { name: 'Renamed' });
  });

  it('remove forwards user id and profile id', async () => {
    const remove = jest.fn().mockResolvedValue(undefined);
    const controller = new ProfilesController({ remove } as unknown as ProfilesService);

    await controller.remove(user, 'p4');
    expect(remove).toHaveBeenCalledWith('user-1', 'p4');
  });
});

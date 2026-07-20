import type { AuthUser } from '@jobradar/shared';

import { ApplicationsController } from './applications.controller';
import type { ApplicationsService } from './applications.service';

const user: AuthUser = { id: 'user-1', email: 'a@b.com', digestEnabled: true };
const UUID = '11111111-1111-4111-8111-111111111111';

describe('ApplicationsController', () => {
  it('list scopes to the current user', async () => {
    const list = jest.fn().mockResolvedValue([]);
    const controller = new ApplicationsController({ list } as unknown as ApplicationsService);
    await controller.list(user);
    expect(list).toHaveBeenCalledWith('user-1');
  });

  it('listReminders scopes to the current user', async () => {
    const listReminders = jest.fn().mockResolvedValue([]);
    const controller = new ApplicationsController({
      listReminders,
    } as unknown as ApplicationsService);
    await controller.listReminders(user);
    expect(listReminders).toHaveBeenCalledWith('user-1');
  });

  it('create forwards user id and body', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'a1' });
    const controller = new ApplicationsController({ create } as unknown as ApplicationsService);
    await controller.create(user, { vacancyId: UUID });
    expect(create).toHaveBeenCalledWith('user-1', { vacancyId: UUID });
  });

  it('reorder forwards user id and columns', async () => {
    const reorder = jest.fn().mockResolvedValue([]);
    const controller = new ApplicationsController({ reorder } as unknown as ApplicationsService);
    const body = { columns: [{ stage: 'applied' as const, orderedIds: [UUID] }] };
    await controller.reorder(user, body);
    expect(reorder).toHaveBeenCalledWith('user-1', body);
  });

  it('update forwards user id, id and body', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'a1' });
    const controller = new ApplicationsController({ update } as unknown as ApplicationsService);
    await controller.update(user, 'a1', { stage: 'offer' });
    expect(update).toHaveBeenCalledWith('user-1', 'a1', { stage: 'offer' });
  });

  it('remove forwards user id and id', async () => {
    const remove = jest.fn().mockResolvedValue(undefined);
    const controller = new ApplicationsController({ remove } as unknown as ApplicationsService);
    await controller.remove(user, 'a1');
    expect(remove).toHaveBeenCalledWith('user-1', 'a1');
  });
});

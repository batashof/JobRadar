import type { AuthUser, DayPlanDetail, PlannerTodayResponse } from '@jobradar/shared';

import { PlannerController } from './planner.controller';
import type { PlannerService } from './planner.service';

const user: AuthUser = {
  id: 'user-1',
  email: 'dev@jobradar.local',
  digestEnabled: true,
  language: 'ru',
};

function controllerWith(service: Partial<Record<keyof PlannerService, unknown>>) {
  return new PlannerController(service as unknown as PlannerService);
}

describe('PlannerController', () => {
  it('returns today for the current user', async () => {
    const today = { today: '2026-07-23', plan: null } as PlannerTodayResponse;
    const getToday = jest.fn().mockResolvedValue(today);

    await expect(controllerWith({ getToday }).getToday(user)).resolves.toBe(today);
    expect(getToday).toHaveBeenCalledWith(user.id);
  });

  it('passes the account language to candidate collection (ADR-014)', async () => {
    const getCandidates = jest.fn().mockResolvedValue({ candidates: [], debt: { count: 0, minutes: 0 } });

    await controllerWith({ getCandidates }).getCandidates(user);
    expect(getCandidates).toHaveBeenCalledWith(user.id, 'ru');
  });

  it('scopes plan acceptance to the owning user', async () => {
    const detail = { id: 'plan-1' } as DayPlanDetail;
    const acceptPlan = jest.fn().mockResolvedValue(detail);

    await expect(controllerWith({ acceptPlan }).acceptPlan(user, 'plan-1')).resolves.toBe(detail);
    expect(acceptPlan).toHaveBeenCalledWith(user.id, 'plan-1');
  });

  it('delegates block add / update / drop with the body', async () => {
    const addBlock = jest.fn().mockResolvedValue({});
    const updateBlock = jest.fn().mockResolvedValue({});
    const dropBlock = jest.fn().mockResolvedValue({});
    const controller = controllerWith({ addBlock, updateBlock, dropBlock });

    const body = { title: 'Apply to Acme', category: 'job_search' as const };
    await controller.addBlock(user, body);
    await controller.updateBlock(user, 'block-1', { estimateMinutes: 45 });
    await controller.dropBlock(user, 'block-1', { reason: 'avoided' });

    expect(addBlock).toHaveBeenCalledWith(user.id, body);
    expect(updateBlock).toHaveBeenCalledWith(user.id, 'block-1', { estimateMinutes: 45 });
    expect(dropBlock).toHaveBeenCalledWith(user.id, 'block-1', { reason: 'avoided' });
  });

  it('sends the reorder list through to the service', async () => {
    const reorder = jest.fn().mockResolvedValue({});
    const body = { blockIds: ['b1', 'b2'] };

    await controllerWith({ reorder }).reorder(user, 'plan-1', body);
    expect(reorder).toHaveBeenCalledWith(user.id, 'plan-1', body);
  });

  it('turns an intent PATCH into a null when the field is omitted', async () => {
    const setIntent = jest.fn().mockResolvedValue({});
    await controllerWith({ setIntent }).setIntent(user, 'plan-1', {});
    expect(setIntent).toHaveBeenCalledWith(user.id, 'plan-1', null);
  });
});

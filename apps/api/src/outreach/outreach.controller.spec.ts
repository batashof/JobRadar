import type { AuthUser, BriefResponse, CoverLetterResponse } from '@jobradar/shared';

import { OutreachController } from './outreach.controller';
import type { OutreachService } from './outreach.service';

const user: AuthUser = { id: 'user-1', email: 'dev@jobradar.local', digestEnabled: true };

describe('OutreachController', () => {
  it('delegates brief generation with the force flag parsed', async () => {
    const result: BriefResponse = {
      summaryRu: 'Кратко о вакансии',
      generatedAt: '2026-07-21T00:00:00.000Z',
      cached: false,
    };
    const brief = jest.fn().mockResolvedValue(result);
    const controller = new OutreachController({ brief } as unknown as OutreachService);

    await expect(controller.brief(user, 'v1', undefined)).resolves.toBe(result);
    expect(brief).toHaveBeenCalledWith(user.id, 'v1', false);

    await controller.brief(user, 'v1', 'true');
    expect(brief).toHaveBeenLastCalledWith(user.id, 'v1', true);
  });

  it('delegates cover letter generation', async () => {
    const result: CoverLetterResponse = { coverLetter: 'Dear team…' };
    const coverLetter = jest.fn().mockResolvedValue(result);
    const controller = new OutreachController({ coverLetter } as unknown as OutreachService);

    await expect(controller.coverLetter(user, 'v1')).resolves.toBe(result);
    expect(coverLetter).toHaveBeenCalledWith(user.id, 'v1');
  });
});

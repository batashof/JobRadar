import { BadRequestException } from '@nestjs/common';
import type { AuthUser, ResumeItem } from '@jobradar/shared';

import { ResumesController } from './resumes.controller';
import type { ResumesService } from './resumes.service';

const user: AuthUser = { id: 'user-1', email: 'dev@jobradar.local', digestEnabled: true, language: 'ru' };

const item: ResumeItem = {
  id: 'r1',
  filename: 'cv.pdf',
  isActive: true,
  uploadedAt: '2026-07-20T00:00:00.000Z',
  extractedChars: 1234,
};

describe('ResumesController', () => {
  it('lists resumes scoped to the user', async () => {
    const list = jest.fn().mockResolvedValue([item]);
    const controller = new ResumesController({ list } as unknown as ResumesService);

    await expect(controller.list(user)).resolves.toEqual([item]);
    expect(list).toHaveBeenCalledWith(user.id);
  });

  it('rejects an upload without a file before touching the service', () => {
    const upload = jest.fn();
    const controller = new ResumesController({ upload } as unknown as ResumesService);

    expect(() => controller.upload(user, undefined)).toThrow(BadRequestException);
    expect(upload).not.toHaveBeenCalled();
  });

  it('passes the uploaded buffer and original name to the service', async () => {
    const upload = jest.fn().mockResolvedValue(item);
    const controller = new ResumesController({ upload } as unknown as ResumesService);
    const file = {
      originalname: 'cv.pdf',
      buffer: Buffer.from('%PDF-'),
    } as Express.Multer.File;

    await expect(controller.upload(user, file)).resolves.toBe(item);
    expect(upload).toHaveBeenCalledWith(user.id, 'cv.pdf', file.buffer);
  });

  it('serves the PDF with safe headers', async () => {
    const getFile = jest
      .fn()
      .mockResolvedValue({ filename: 'my cv (final).pdf', file: Buffer.from('%PDF-') });
    const controller = new ResumesController({ getFile } as unknown as ResumesService);
    const res = { set: jest.fn() };

    const streamable = await controller.getFile(user, 'r1', res as never);

    expect(getFile).toHaveBeenCalledWith(user.id, 'r1');
    expect(res.set).toHaveBeenCalledWith({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="my_cv__final_.pdf"',
    });
    expect(streamable).toBeDefined();
  });

  it('activates and removes through the service', async () => {
    const activate = jest.fn().mockResolvedValue(item);
    const remove = jest.fn().mockResolvedValue(undefined);
    const controller = new ResumesController({ activate, remove } as unknown as ResumesService);

    await expect(controller.activate(user, 'r1')).resolves.toBe(item);
    expect(activate).toHaveBeenCalledWith(user.id, 'r1');

    await expect(controller.remove(user, 'r1')).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith(user.id, 'r1');
  });
});

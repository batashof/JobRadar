import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RESUME_MAX_BYTES, type AuthUser } from '@jobradar/shared';
import type { Response } from 'express';

import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ResumesService } from './resumes.service';

@Controller('resumes')
@UseGuards(AuthGuard)
export class ResumesController {
  constructor(private readonly resumes: ResumesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.resumes.list(user.id);
  }

  @Post()
  @HttpCode(201)
  // Memory storage (multer default): the buffer goes straight to Postgres.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: RESUME_MAX_BYTES } }))
  upload(@CurrentUser() user: AuthUser, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Attach a PDF file in the "file" field');
    return this.resumes.upload(user.id, file.originalname, file.buffer);
  }

  @Get(':id/file')
  async getFile(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { filename, file } = await this.resumes.getFile(user.id, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename.replace(/[^\w.-]/g, '_')}"`,
    });
    return new StreamableFile(file);
  }

  @Post(':id/activate')
  activate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.resumes.activate(user.id, id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.resumes.remove(user.id, id);
  }
}

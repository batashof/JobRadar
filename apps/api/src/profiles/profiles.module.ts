import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { MatchingModule } from '../matching/matching.module';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';

@Module({
  imports: [AuthModule, MatchingModule],
  controllers: [ProfilesController],
  providers: [ProfilesService],
})
export class ProfilesModule {}

import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { MatchesController } from './matches.controller';
import { MatchesService } from './matches.service';
import { MatchingService } from './matching.service';

@Module({
  imports: [AuthModule],
  controllers: [MatchesController],
  providers: [MatchingService, MatchesService],
  exports: [MatchingService],
})
export class MatchingModule {}

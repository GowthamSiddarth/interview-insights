import { Module } from '@nestjs/common';
import { RecruiterRatingsController } from './recruiter-ratings.controller';
import { RecruiterRatingsService } from './recruiter-ratings.service';
import { ModerationModule } from '../moderation/moderation.module';

@Module({
  imports: [ModerationModule],
  controllers: [RecruiterRatingsController],
  providers: [RecruiterRatingsService],
  exports: [RecruiterRatingsService],
})
export class RecruiterRatingsModule {}

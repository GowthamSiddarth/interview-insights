import { Module } from '@nestjs/common';
import { RecruiterRatingsController } from './recruiter-ratings.controller';
import { RecruiterRatingsService } from './recruiter-ratings.service';
import { CandidateAuthModule } from '../candidate-auth/candidate-auth.module';
import { ModerationModule } from '../moderation/moderation.module';
import { EditThrottleModule } from '../common/edit-throttle.module';

@Module({
  imports: [ModerationModule, CandidateAuthModule, EditThrottleModule],
  controllers: [RecruiterRatingsController],
  providers: [RecruiterRatingsService],
  exports: [RecruiterRatingsService],
})
export class RecruiterRatingsModule {}

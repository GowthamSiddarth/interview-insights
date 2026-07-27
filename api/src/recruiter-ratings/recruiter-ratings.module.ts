import { Module } from '@nestjs/common';
import { RecruiterRatingsController } from './recruiter-ratings.controller';
import { RecruiterRatingsService } from './recruiter-ratings.service';
import { CandidateAuthModule } from '../candidate-auth/candidate-auth.module';
import { ModerationModule } from '../moderation/moderation.module';
import { FraudChecksModule } from '../fraud-checks/fraud-checks.module';
import { EditThrottleModule } from '../common/edit-throttle.module';
import { AiModerationModule } from '../ai-moderation/ai-moderation.module';

@Module({
  imports: [ModerationModule, FraudChecksModule, CandidateAuthModule, EditThrottleModule, AiModerationModule],
  controllers: [RecruiterRatingsController],
  providers: [RecruiterRatingsService],
  exports: [RecruiterRatingsService],
})
export class RecruiterRatingsModule {}

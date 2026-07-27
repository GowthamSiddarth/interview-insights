import { Module } from '@nestjs/common';
import { OverallReviewsController } from './overall-reviews.controller';
import { OverallReviewsService } from './overall-reviews.service';
import { CandidateAuthModule } from '../candidate-auth/candidate-auth.module';
import { ModerationModule } from '../moderation/moderation.module';
import { FraudChecksModule } from '../fraud-checks/fraud-checks.module';
import { EditThrottleModule } from '../common/edit-throttle.module';
import { AiModerationModule } from '../ai-moderation/ai-moderation.module';

@Module({
  imports: [ModerationModule, FraudChecksModule, CandidateAuthModule, EditThrottleModule, AiModerationModule],
  controllers: [OverallReviewsController],
  providers: [OverallReviewsService],
  exports: [OverallReviewsService],
})
export class OverallReviewsModule {}

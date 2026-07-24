import { Module } from '@nestjs/common';
import { OverallReviewsController } from './overall-reviews.controller';
import { OverallReviewsService } from './overall-reviews.service';
import { CandidateAuthModule } from '../candidate-auth/candidate-auth.module';
import { ModerationModule } from '../moderation/moderation.module';
import { EditThrottleModule } from '../common/edit-throttle.module';

@Module({
  imports: [ModerationModule, CandidateAuthModule, EditThrottleModule],
  controllers: [OverallReviewsController],
  providers: [OverallReviewsService],
  exports: [OverallReviewsService],
})
export class OverallReviewsModule {}

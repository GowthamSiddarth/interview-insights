import { Module } from '@nestjs/common';
import { RoundRatingsController } from './round-ratings.controller';
import { RoundRatingsService } from './round-ratings.service';
import { CandidateAuthModule } from '../candidate-auth/candidate-auth.module';
import { ModerationModule } from '../moderation/moderation.module';
import { FraudChecksModule } from '../fraud-checks/fraud-checks.module';
import { SearchModule } from '../search/search.module';
import { EditThrottleModule } from '../common/edit-throttle.module';
import { AiModerationModule } from '../ai-moderation/ai-moderation.module';

@Module({
  imports: [
    ModerationModule,
    FraudChecksModule,
    CandidateAuthModule,
    SearchModule,
    EditThrottleModule,
    AiModerationModule,
  ],
  controllers: [RoundRatingsController],
  providers: [RoundRatingsService],
  exports: [RoundRatingsService],
})
export class RoundRatingsModule {}

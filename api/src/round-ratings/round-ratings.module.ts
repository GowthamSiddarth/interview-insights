import { Module } from '@nestjs/common';
import { RoundRatingsController } from './round-ratings.controller';
import { RoundRatingsService } from './round-ratings.service';
import { ModerationModule } from '../moderation/moderation.module';
import { FraudChecksModule } from '../fraud-checks/fraud-checks.module';

@Module({
  imports: [ModerationModule, FraudChecksModule],
  controllers: [RoundRatingsController],
  providers: [RoundRatingsService],
  exports: [RoundRatingsService],
})
export class RoundRatingsModule {}

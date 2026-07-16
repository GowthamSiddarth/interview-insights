import { Module } from '@nestjs/common';
import { RoundRatingsController } from './round-ratings.controller';
import { RoundRatingsService } from './round-ratings.service';
import { ModerationModule } from '../moderation/moderation.module';

@Module({
  imports: [ModerationModule],
  controllers: [RoundRatingsController],
  providers: [RoundRatingsService],
  exports: [RoundRatingsService],
})
export class RoundRatingsModule {}

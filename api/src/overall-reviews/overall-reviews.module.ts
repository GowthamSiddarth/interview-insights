import { Module } from '@nestjs/common';
import { OverallReviewsController } from './overall-reviews.controller';
import { OverallReviewsService } from './overall-reviews.service';
import { ModerationModule } from '../moderation/moderation.module';

@Module({
  imports: [ModerationModule],
  controllers: [OverallReviewsController],
  providers: [OverallReviewsService],
  exports: [OverallReviewsService],
})
export class OverallReviewsModule {}

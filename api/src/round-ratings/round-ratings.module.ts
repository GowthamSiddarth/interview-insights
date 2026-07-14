import { Module } from '@nestjs/common';
import { RoundRatingsController } from './round-ratings.controller';
import { RoundRatingsService } from './round-ratings.service';

@Module({
  controllers: [RoundRatingsController],
  providers: [RoundRatingsService],
  exports: [RoundRatingsService],
})
export class RoundRatingsModule {}

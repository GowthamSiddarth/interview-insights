import { Module } from '@nestjs/common';
import { GlobalAveragesService } from './global-averages.service';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';

@Module({
  controllers: [AnalyticsController],
  providers: [GlobalAveragesService, AnalyticsService],
  exports: [GlobalAveragesService, AnalyticsService],
})
export class AnalyticsModule {}

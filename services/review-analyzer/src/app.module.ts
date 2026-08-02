import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthModule } from './health/health.module';
import { AnalysisModule } from './analysis/analysis.module';

@Module({
  imports: [ScheduleModule.forRoot(), HealthModule, AnalysisModule],
})
export class AppModule {}

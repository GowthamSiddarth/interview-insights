import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { AnalysisConsumerService } from './analysis-consumer.service';

@Module({
  imports: [EventsModule],
  providers: [AnalysisConsumerService],
})
export class AnalysisModule {}

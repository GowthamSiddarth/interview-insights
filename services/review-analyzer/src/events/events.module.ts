import { Module } from '@nestjs/common';
import { EVENT_CONSUMER, eventConsumerProvider, kafkaClientProvider } from './redpanda-client.provider';

// Mirrors services/notification-service/src/events/events.module.ts's shape
// (provider registration only) — the actual subscribe/run wiring lives in
// AnalysisModule's AnalysisConsumerService, not here.
@Module({
  providers: [kafkaClientProvider, eventConsumerProvider],
  exports: [EVENT_CONSUMER],
})
export class EventsModule {}

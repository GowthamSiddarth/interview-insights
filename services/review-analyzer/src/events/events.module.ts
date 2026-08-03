import { Module } from '@nestjs/common';
import {
  EVENT_CONSUMER,
  EVENT_PRODUCER,
  eventConsumerProvider,
  eventProducerProvider,
  kafkaClientProvider,
} from './redpanda-client.provider';
import { VerdictPublisher } from './verdict-publisher.service';

// Mirrors services/notification-service/src/events/events.module.ts's shape
// (provider registration only) — the actual subscribe/run wiring lives in
// AnalysisModule's AnalysisConsumerService, not here. GitHub issue #340
// added EVENT_PRODUCER/VerdictPublisher — this service's first producer.
@Module({
  providers: [kafkaClientProvider, eventConsumerProvider, eventProducerProvider, VerdictPublisher],
  exports: [EVENT_CONSUMER, EVENT_PRODUCER, VerdictPublisher],
})
export class EventsModule {}

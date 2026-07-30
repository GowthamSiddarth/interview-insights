import { Module } from '@nestjs/common';
import { EVENT_CONSUMER, eventConsumerProvider, kafkaClientProvider } from './redpanda-client.provider';

// Mirrors api/src/events/events.module.ts's shape (provider registration
// only) — the actual subscribe/run wiring lives in NotificationsModule's
// NotificationConsumerService, not here, since unlike api's
// DomainEventPublisher this consumer has no other caller to be reusable
// plumbing for.
@Module({
  providers: [kafkaClientProvider, eventConsumerProvider],
  exports: [EVENT_CONSUMER],
})
export class EventsModule {}

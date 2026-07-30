import { Module } from '@nestjs/common';
import { kafkaClientProvider, eventProducerProvider } from './redpanda-client.provider';
import { DomainEventPublisher } from './domain-event-publisher';

// Not yet imported by AppModule — GitHub issue #332 wires the first real
// publish() call into a write path and imports this module from there.
// Deliberately not eagerly wired here: nothing calls DomainEventPublisher
// yet, and importing it into AppModule now would make every e2e test's
// full-app bootstrap attempt a Redpanda connection that CI doesn't run
// (GitHub issue #330's acceptance criteria deliberately left CI alone).
@Module({
  providers: [kafkaClientProvider, eventProducerProvider, DomainEventPublisher],
  exports: [DomainEventPublisher],
})
export class EventsModule {}

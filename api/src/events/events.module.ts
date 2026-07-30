import { Module } from '@nestjs/common';
import { kafkaClientProvider, eventProducerProvider } from './redpanda-client.provider';
import { DomainEventPublisher } from './domain-event-publisher';

// Imported by ModerationModule as of GitHub issue #332 — the first real
// caller of DomainEventPublisher. CI now runs a real `redpanda` service
// container for the api job's e2e run (.github/workflows/ci.yml), so
// this module's onModuleInit() connect attempt succeeds there too, not
// just in local dev/kind.
@Module({
  providers: [kafkaClientProvider, eventProducerProvider, DomainEventPublisher],
  exports: [DomainEventPublisher],
})
export class EventsModule {}

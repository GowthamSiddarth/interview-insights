import { Module } from '@nestjs/common';
import { EVENT_CONSUMER, kafkaClientProvider, eventProducerProvider, eventConsumerProvider } from './redpanda-client.provider';
import { DomainEventPublisher } from './domain-event-publisher';

// Imported by ModerationModule as of GitHub issue #332 — the first real
// caller of DomainEventPublisher. CI now runs a real `redpanda` service
// container for the api job's e2e run (.github/workflows/ci.yml), so
// this module's onModuleInit() connect attempt succeeds there too, not
// just in local dev/kind. GitHub issue #340 (D81) added EVENT_CONSUMER —
// api's first-ever event consumer, imported by VerdictConsumerModule.
@Module({
  providers: [kafkaClientProvider, eventProducerProvider, eventConsumerProvider, DomainEventPublisher],
  exports: [DomainEventPublisher, EVENT_CONSUMER],
})
export class EventsModule {}

import { Provider } from '@nestjs/common';
import { Consumer, Kafka, Producer } from 'kafkajs';

export const KAFKA_CLIENT = 'KAFKA_CLIENT';
export const EVENT_PRODUCER = 'EVENT_PRODUCER';
// GitHub issue #340 (Phase 32, D81) — api's first-ever event consumer:
// applies moderation.<type>.verdict_computed.v1, published by
// review-analyzer, back onto the entity row.
export const EVENT_CONSUMER = 'EVENT_CONSUMER';

// Same shape as ../search/opensearch-client.provider.ts: a thin factory
// reading the broker address from env, defaulting to the native-dev port
// (infra/docker-compose.yml's `redpanda` service publishes its external
// listener on 19092 — GitHub issue #330). Documented in api/.env.example
// as of GitHub issue #332, which is what first makes AppModule actually
// read this at boot (via ModerationModule -> EventsModule).
export const kafkaClientProvider: Provider = {
  provide: KAFKA_CLIENT,
  useFactory: () =>
    new Kafka({
      clientId: 'interview-insights-api',
      brokers: (process.env.REDPANDA_BROKERS ?? 'localhost:19092').split(','),
    }),
};

export const eventProducerProvider: Provider = {
  provide: EVENT_PRODUCER,
  inject: [KAFKA_CLIENT],
  useFactory: (kafka: Kafka): Producer => kafka.producer(),
};

// Fixed, not random — a real consumer group must resume from its last
// committed offset across restarts/deploys. Distinct from notification-
// service's/review-analyzer's own consumer groups (docs/EVENTS.md) — every
// consumer group gets its own copy of every message.
const CONSUMER_GROUP_ID = 'api';

export const eventConsumerProvider: Provider = {
  provide: EVENT_CONSUMER,
  inject: [KAFKA_CLIENT],
  useFactory: (kafka: Kafka): Consumer => kafka.consumer({ groupId: CONSUMER_GROUP_ID }),
};

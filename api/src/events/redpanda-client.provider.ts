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

// GitHub issue #340 fallout, found in CI: api is the *monolith*, so ~26
// e2e spec files boot the full AppModule (most for plain HTTP testing,
// nothing to do with Kafka) — before this issue, none of that mattered
// since api had no consumer. Now every one of those files joins/leaves
// this same fixed 'api' group as its own app spins up/tears down, and
// jest runs spec files in parallel workers by default: one file's
// join/leave triggers a group rebalance that can transiently steal the
// partition assignment away from another file's (verdict-consumer.e2e-spec.ts)
// long-lived consumer mid-test, delaying delivery past its polling
// window (observed: 158 join/leave cycles in one CI run, one flaky
// failure). `API_KAFKA_CONSUMER_GROUP_ID` lets that one test file opt
// into its own private group, read lazily here (not captured into a
// module-level constant) so a test can set it via `process.env` right
// before `Test.createTestingModule(...).compile()` — production never
// sets this var, so it always gets the stable 'api' group.
export const eventConsumerProvider: Provider = {
  provide: EVENT_CONSUMER,
  inject: [KAFKA_CLIENT],
  useFactory: (kafka: Kafka): Consumer =>
    kafka.consumer({ groupId: process.env.API_KAFKA_CONSUMER_GROUP_ID ?? CONSUMER_GROUP_ID }),
};

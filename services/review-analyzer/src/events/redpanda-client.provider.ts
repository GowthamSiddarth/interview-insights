import { Provider } from '@nestjs/common';
import { Consumer, Kafka } from 'kafkajs';

export const KAFKA_CLIENT = 'KAFKA_CLIENT';
export const EVENT_CONSUMER = 'EVENT_CONSUMER';

// Fixed, not random — a real consumer group must resume from its last
// committed offset across restarts/deploys, not start a fresh group (and
// therefore a fresh "beginning") every time the pod restarts. A distinct
// group id from 'notification-service' (docs/EVENTS.md) — every consumer
// group gets its own copy of every message, so this service's processing
// never affects notification-service's.
const CONSUMER_GROUP_ID = 'review-analyzer';

export const kafkaClientProvider: Provider = {
  provide: KAFKA_CLIENT,
  useFactory: () =>
    new Kafka({
      clientId: 'interview-insights-review-analyzer',
      brokers: (process.env.REDPANDA_BROKERS ?? 'localhost:19092').split(','),
    }),
};

export const eventConsumerProvider: Provider = {
  provide: EVENT_CONSUMER,
  inject: [KAFKA_CLIENT],
  useFactory: (kafka: Kafka): Consumer => kafka.consumer({ groupId: CONSUMER_GROUP_ID }),
};

import { Provider } from '@nestjs/common';
import { Kafka, Producer } from 'kafkajs';

export const KAFKA_CLIENT = 'KAFKA_CLIENT';
export const EVENT_PRODUCER = 'EVENT_PRODUCER';

// Same shape as ../search/opensearch-client.provider.ts: a thin factory
// reading the broker address from env, defaulting to the native-dev port
// (infra/docker-compose.yml's `redpanda` service publishes its external
// listener on 19092 — GitHub issue #330). Not yet added to
// api/.env.example: nothing reads this at app boot until GitHub issue
// #332 imports EventsModule into AppModule.
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

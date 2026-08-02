import { Kafka } from 'kafkajs';

const REDPANDA_BROKERS = (process.env.REDPANDA_BROKERS ?? 'localhost:19092').split(',');

// Publishes a real event onto the real broker the same way
// DomainEventPublisher does in api (key = aggregate id, JSON value) — the
// e2e spec's stand-in for "api's real write path just published this,"
// without needing api itself running as part of this service's own CI
// job. Not this service's own reusable plumbing (it never produces in
// production, only consumes) — test-only. Duplicated from
// services/notification-service/test/support/redpanda-producer.ts.
export async function publishTestEvent<T>(topic: string, event: T, key: string): Promise<void> {
  const kafka = new Kafka({ clientId: 'e2e-test-producer', brokers: REDPANDA_BROKERS });
  const producer = kafka.producer();
  try {
    await producer.connect();
    await producer.send({ topic, messages: [{ key, value: JSON.stringify(event) }] });
  } finally {
    await producer.disconnect();
  }
}

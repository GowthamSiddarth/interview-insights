import { Kafka } from 'kafkajs';

const REDPANDA_BROKERS = (process.env.REDPANDA_BROKERS ?? 'localhost:19092').split(',');

// GitHub issue #340 (Phase 32, D81) — stands in for "review-analyzer's real
// consumer just published this," without needing review-analyzer itself
// running as part of api's own CI job. Same shape as
// services/review-analyzer/test/support/redpanda-producer.ts and
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

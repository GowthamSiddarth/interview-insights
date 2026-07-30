import { Kafka } from 'kafkajs';

const REDPANDA_BROKERS = (process.env.REDPANDA_BROKERS ?? 'localhost:19092').split(',');

// GitHub issue #332 — proves a real domain event landed on a real topic,
// same "needs a real instance, not a mock" philosophy as
// test/support/mailpit.ts (docs/DECISIONS.md D29). A fresh, uniquely
// grouped consumer per call (reading `fromBeginning`) rather than a
// shared subscription, so concurrent/sequential e2e specs never race
// over consumer-group offsets.
export async function waitForEvent<T>(
  topic: string,
  predicate: (event: T) => boolean,
  timeoutMs = 15000,
): Promise<T> {
  const kafka = new Kafka({ clientId: 'e2e-test-consumer', brokers: REDPANDA_BROKERS });
  const groupId = `e2e-test-${topic}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const consumer = kafka.consumer({ groupId });

  try {
    await consumer.connect();
    await consumer.subscribe({ topic, fromBeginning: true });

    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`No matching event found on topic "${topic}" within ${timeoutMs}ms`));
      }, timeoutMs);

      consumer
        .run({
          // eslint-disable-next-line @typescript-eslint/require-await -- kafkajs's eachMessage type requires a Promise-returning callback; this handler is synchronous
          eachMessage: async ({ message }) => {
            if (!message.value) return;
            const event = JSON.parse(message.value.toString()) as T;
            if (predicate(event)) {
              clearTimeout(timer);
              resolve(event);
            }
          },
        })
        .catch(reject);
    });
  } finally {
    await consumer.disconnect().catch(() => {});
  }
}
